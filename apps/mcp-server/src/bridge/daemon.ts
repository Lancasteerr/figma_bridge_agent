import { randomBytes } from 'node:crypto';
import { createServer, type Server as HttpServer } from 'node:http';

import {
  BRIDGE_PROTOCOL_VERSION,
  BridgeFault,
  DaemonClientProofSchema,
  MAX_RPC_MESSAGE_BYTES,
  RpcRequestSchema,
  toBridgeError,
  type DaemonState,
  type RpcRequest,
} from '@figma-agent/protocol';
import { WebSocket, WebSocketServer, type RawData } from 'ws';

import type { ServerConfig } from '../config/store.js';
import { defaultConfigPath } from '../config/paths.js';
import { updateConfig } from '../config/store.js';
import {
  createDaemonClientProof,
  createDaemonServerProof,
  verifyProof,
} from '../security/proof.js';
import { PluginConnectionBroker } from './plugin-connection.js';
import { PairingManager } from './pairing-manager.js';

interface DaemonClientSession {
  socket: WebSocket;
  pending: Set<symbol>;
}

export interface BridgeDaemonOptions {
  idleTimeoutMs?: number;
  stopTimeoutMs?: number;
  log?: (entry: Record<string, unknown>) => void;
  configPath?: string;
}

/**
 * 单例 Bridge Daemon：同一端口的 `/` 服务 Figma 插件，`/mcp` 服务多个本机 MCP 客户端。
 */
export class BridgeDaemon {
  readonly #config: ServerConfig;
  readonly #configPath: string;
  readonly #broker: PluginConnectionBroker;
  readonly #pairing: PairingManager;
  readonly #clients = new Set<DaemonClientSession>();
  readonly #sockets = new Set<WebSocket>();
  readonly #idleTimeoutMs: number;
  readonly #stopTimeoutMs: number;
  readonly #log: (entry: Record<string, unknown>) => void;
  #httpServer: HttpServer | undefined;
  #pluginServer: WebSocketServer | undefined;
  #clientServer: WebSocketServer | undefined;
  #pairingServer: WebSocketServer | undefined;
  #idleTimer: NodeJS.Timeout | undefined;
  #closing = false;
  #resolveStopped: (() => void) | undefined;
  readonly #stopped = new Promise<void>((resolve) => {
    this.#resolveStopped = resolve;
  });

  constructor(config: ServerConfig, options: BridgeDaemonOptions = {}) {
    this.#config = config;
    this.#idleTimeoutMs = options.idleTimeoutMs ?? 30_000;
    this.#stopTimeoutMs = options.stopTimeoutMs ?? 5_000;
    this.#log = options.log ?? (() => undefined);
    const configPath = options.configPath ?? defaultConfigPath();
    this.#configPath = configPath;
    this.#broker = new PluginConnectionBroker(config, (entry) => this.#log(entry), { configPath });
    this.#pairing = new PairingManager(config, { configPath, log: (entry) => this.#log(entry) });
    this.#broker.onStateChange(() => this.#stateChanged());
    this.#broker.onEvent((event) => {
      this.#broadcast({ version: BRIDGE_PROTOCOL_VERSION, ...event });
    });
  }

  get port(): number {
    const address = this.#httpServer?.address();
    return typeof address === 'object' && address ? address.port : this.#config.port;
  }

  get state(): DaemonState {
    return {
      type: 'daemon.state',
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      pid: process.pid,
      clientCount: this.#clients.size,
      pluginConnected: this.#broker.connected,
      ...(this.#broker.pluginVersion ? { pluginVersion: this.#broker.pluginVersion } : {}),
      pendingCount: this.#broker.pendingCount,
    };
  }

  async start(): Promise<void> {
    if (this.#httpServer) return;
    const pluginServer = new WebSocketServer({
      noServer: true,
      maxPayload: MAX_RPC_MESSAGE_BYTES,
      perMessageDeflate: false,
    });
    const clientServer = new WebSocketServer({
      noServer: true,
      maxPayload: MAX_RPC_MESSAGE_BYTES,
      perMessageDeflate: false,
    });
    const pairingServer = new WebSocketServer({
      noServer: true,
      maxPayload: 64 * 1024,
      perMessageDeflate: false,
    });
    const httpServer = createServer((_request, response) => {
      response.writeHead(404).end();
    });
    this.#pluginServer = pluginServer;
    this.#clientServer = clientServer;
    this.#pairingServer = pairingServer;
    this.#httpServer = httpServer;

    pluginServer.on('connection', (socket) => {
      this.#trackSocket(socket);
      this.#broker.accept(socket);
    });
    clientServer.on('connection', (socket) => {
      this.#trackSocket(socket);
      this.#authenticateClient(socket);
    });
    pairingServer.on('connection', (socket) => {
      this.#trackSocket(socket);
      this.#pairing.accept(socket);
    });
    httpServer.on('upgrade', (request, socket, head) => {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (path === '/mcp') {
        clientServer.handleUpgrade(request, socket, head, (webSocket) => {
          clientServer.emit('connection', webSocket, request);
        });
      } else if (path === '/pair') {
        pairingServer.handleUpgrade(request, socket, head, (webSocket) => {
          pairingServer.emit('connection', webSocket, request);
        });
      } else if (path === '/') {
        pluginServer.handleUpgrade(request, socket, head, (webSocket) => {
          pluginServer.emit('connection', webSocket, request);
        });
      } else {
        socket.destroy();
      }
    });

    await new Promise<void>((resolve, reject) => {
      httpServer.once('listening', resolve);
      httpServer.once('error', reject);
      httpServer.listen(this.#config.port, this.#config.host);
    });
    this.#log({ level: 'info', event: 'daemon_started', pid: process.pid, port: this.port });
    this.#scheduleIdleExit();
  }

  async close(): Promise<void> {
    if (this.#closing) return await this.#stopped;
    this.#closing = true;
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    this.#idleTimer = undefined;
    for (const socket of this.#sockets) socket.close(1001, 'Bridge daemon stopping');
    this.#pairing.stop();
    // 对端若不完成 WebSocket close 握手，短暂宽限后强制释放监听资源。
    const terminationTimer = setTimeout(() => {
      for (const socket of this.#sockets) socket.terminate();
    }, 250);
    this.#clients.clear();
    await this.#broker.stop();
    const httpServer = this.#httpServer;
    this.#httpServer = undefined;
    await Promise.all([
      this.#closeWebSocketServer(this.#pluginServer),
      this.#closeWebSocketServer(this.#clientServer),
      this.#closeWebSocketServer(this.#pairingServer),
      httpServer
        ? new Promise<void>((resolve) => httpServer.close(() => resolve()))
        : Promise.resolve(),
    ]);
    this.#pluginServer = undefined;
    this.#clientServer = undefined;
    this.#pairingServer = undefined;
    clearTimeout(terminationTimer);
    this.#log({ level: 'info', event: 'daemon_stopped', pid: process.pid });
    this.#resolveStopped?.();
    this.#resolveStopped = undefined;
  }

  async waitUntilStopped(): Promise<void> {
    await this.#stopped;
  }

  #authenticateClient(socket: WebSocket): void {
    const daemonNonce = randomBytes(24).toString('base64url');
    let authenticated = false;
    const timer = setTimeout(() => socket.close(4001, 'Authentication timed out'), 5_000);
    socket.send(
      JSON.stringify({
        type: 'daemon.auth.challenge',
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        daemonNonce,
      }),
    );
    socket.on('message', (data) => {
      if (authenticated) return;
      const value = this.#parseJson(data);
      if (this.#hasWrongProtocol(value, 'daemon.auth.client-proof')) {
        this.#rejectClient(
          socket,
          'PROTOCOL_MISMATCH',
          'Daemon protocol version is not supported.',
        );
        return;
      }
      const parsed = DaemonClientProofSchema.safeParse(value);
      if (!parsed.success || parsed.data.daemonNonce !== daemonNonce) {
        this.#rejectClient(socket, 'AUTH_FAILED', 'Invalid daemon authentication response.');
        return;
      }
      const expected = createDaemonClientProof(
        this.#config.daemonSecret,
        daemonNonce,
        parsed.data.clientNonce,
      );
      if (!verifyProof(parsed.data.proof, expected)) {
        this.#rejectClient(socket, 'AUTH_FAILED', 'Daemon client secret is not valid.');
        return;
      }
      clearTimeout(timer);
      authenticated = true;
      const session: DaemonClientSession = { socket, pending: new Set() };
      this.#clients.add(session);
      socket.send(
        JSON.stringify({
          type: 'daemon.auth.server-proof',
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          daemonNonce,
          clientNonce: parsed.data.clientNonce,
          proof: createDaemonServerProof(
            this.#config.daemonSecret,
            daemonNonce,
            parsed.data.clientNonce,
          ),
        }),
      );
      socket.send(JSON.stringify(this.state));
      socket.on('message', (message) => void this.#handleClientRequest(session, message));
      socket.once('close', () => {
        session.pending.clear();
        this.#clients.delete(session);
        this.#stateChanged();
      });
      this.#stateChanged();
    });
    socket.once('close', () => clearTimeout(timer));
  }

  async #handleClientRequest(session: DaemonClientSession, data: RawData): Promise<void> {
    const parsed = RpcRequestSchema.safeParse(this.#parseJson(data));
    if (!parsed.success) return;
    const request = parsed.data;
    if (request.method === '$daemon.status') {
      this.#sendSuccess(session.socket, request.id, this.#statusResult());
      return;
    }
    if (request.method === '$daemon.stop') {
      this.#sendSuccess(session.socket, request.id, this.#statusResult());
      setTimeout(() => void this.#gracefulStop(), 0);
      return;
    }
    if (request.method === '$daemon.pair.start') {
      this.#sendSuccess(session.socket, request.id, this.#pairing.start());
      this.#stateChanged();
      return;
    }
    if (request.method === '$daemon.pair.status') {
      this.#sendSuccess(session.socket, request.id, this.#pairing.status);
      return;
    }
    if (request.method === '$daemon.pair.cancel') {
      this.#sendSuccess(session.socket, request.id, this.#pairing.cancel());
      this.#stateChanged();
      return;
    }
    if (request.method === '$daemon.devices.list') {
      this.#sendSuccess(
        session.socket,
        request.id,
        Object.entries(this.#config.pairedClients).map(([deviceId, device]) => ({
          deviceId,
          createdAt: device.createdAt,
          lastSeenAt: device.lastSeenAt,
          pluginVersion: device.pluginVersion,
          connected: this.#broker.deviceId === deviceId,
        })),
      );
      return;
    }
    if (request.method === '$daemon.devices.revoke') {
      await this.#revokeDevices(request.params);
      this.#sendSuccess(session.socket, request.id, { revoked: true });
      return;
    }

    const token = Symbol(request.id);
    session.pending.add(token);
    this.#stateChanged();
    try {
      const result = await this.#broker.request(request.method, request.params, request.timeoutMs);
      this.#sendSuccess(session.socket, request.id, result);
    } catch (error) {
      this.#sendFailure(session.socket, request, error);
    } finally {
      session.pending.delete(token);
      this.#stateChanged();
    }
  }

  async #gracefulStop(): Promise<void> {
    const deadline = Date.now() + this.#stopTimeoutMs;
    while (this.#broker.pendingCount > 0 && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
    await this.close();
  }

  #stateChanged(): void {
    this.#broadcast(this.state);
    this.#scheduleIdleExit();
  }

  #scheduleIdleExit(): void {
    if (this.#closing) return;
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    this.#idleTimer = undefined;
    if (
      this.#clients.size ||
      this.#broker.connected ||
      this.#broker.pendingCount ||
      this.#pairing.active
    ) {
      return;
    }
    this.#idleTimer = setTimeout(() => void this.close(), this.#idleTimeoutMs);
  }

  #statusResult(): Omit<DaemonState, 'type'> {
    const state = this.state;
    return {
      protocolVersion: state.protocolVersion,
      pid: state.pid,
      clientCount: state.clientCount,
      pluginConnected: state.pluginConnected,
      ...(state.pluginVersion ? { pluginVersion: state.pluginVersion } : {}),
      pendingCount: state.pendingCount,
    };
  }

  async #revokeDevices(params: unknown): Promise<void> {
    const requested =
      typeof params === 'object' && params !== null && 'deviceId' in params
        ? String(params.deviceId)
        : undefined;
    const all =
      typeof params === 'object' && params !== null && 'all' in params && params.all === true;
    if (!all && !requested) {
      throw new BridgeFault({
        code: 'AUTH_REQUIRED',
        message: 'A deviceId or all=true is required.',
        retryable: false,
      });
    }
    const updated = await updateConfig((config) => {
      const pairedClients = { ...config.pairedClients };
      if (all) {
        for (const deviceId of Object.keys(pairedClients)) delete pairedClients[deviceId];
      } else if (requested) {
        delete pairedClients[requested];
      }
      return { ...config, pairedClients };
    }, this.#configPath);
    Object.assign(this.#config, updated);
    if (all || (requested && this.#broker.deviceId === requested)) {
      this.#broker.revokeCurrentDevice();
    }
  }

  #sendSuccess(socket: WebSocket, id: string, result: unknown): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ version: BRIDGE_PROTOCOL_VERSION, id, ok: true, result }));
  }

  #sendFailure(socket: WebSocket, request: RpcRequest, error: unknown): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(
      JSON.stringify({
        version: BRIDGE_PROTOCOL_VERSION,
        id: request.id,
        ok: false,
        error: toBridgeError(error),
      }),
    );
  }

  #broadcast(value: unknown): void {
    const text = JSON.stringify(value);
    for (const client of this.#clients) {
      if (client.socket.readyState === WebSocket.OPEN) client.socket.send(text);
    }
  }

  #rejectClient(
    socket: WebSocket,
    code: 'AUTH_FAILED' | 'PROTOCOL_MISMATCH',
    message: string,
  ): void {
    socket.send(JSON.stringify({ type: 'daemon.auth.rejected', code, message }));
    socket.close(4003, message);
  }

  #trackSocket(socket: WebSocket): void {
    this.#sockets.add(socket);
    socket.once('close', () => this.#sockets.delete(socket));
  }

  #parseJson(data: RawData): unknown {
    try {
      const text = Buffer.isBuffer(data)
        ? data.toString('utf8')
        : data instanceof ArrayBuffer
          ? Buffer.from(data).toString('utf8')
          : Buffer.concat(data).toString('utf8');
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  #hasWrongProtocol(value: unknown, type: string): boolean {
    return (
      typeof value === 'object' &&
      value !== null &&
      'type' in value &&
      value.type === type &&
      'protocolVersion' in value &&
      value.protocolVersion !== BRIDGE_PROTOCOL_VERSION
    );
  }

  async #closeWebSocketServer(server: WebSocketServer | undefined): Promise<void> {
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
