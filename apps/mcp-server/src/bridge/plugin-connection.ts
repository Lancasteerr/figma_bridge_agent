import { randomBytes, randomUUID } from 'node:crypto';

import {
  AuthPluginProofSchema,
  BRIDGE_PROTOCOL_VERSION,
  BridgeFault,
  DEFAULT_REQUEST_TIMEOUT_MS,
  MAX_RPC_MESSAGE_BYTES,
  RpcEventSchema,
  RpcResponseSchema,
  type RpcRequest,
  type RpcResponse,
} from '@figma-agent/protocol';
import { WebSocket, WebSocketServer, type RawData } from 'ws';

import type { ServerConfig } from '../config/store.js';
import { createPluginProof, createServerProof, verifyProof } from '../security/proof.js';

interface PendingRequest {
  id: string;
  method: string;
  startedAt: number;
  resolve(value: unknown): void;
  reject(reason: unknown): void;
  timer: NodeJS.Timeout;
}

export interface BrokerEvent {
  event: string;
  sequence: number;
  payload: unknown;
}

export class PluginConnectionBroker {
  readonly #config: ServerConfig;
  readonly #pending = new Map<string, PendingRequest>();
  readonly #eventListeners = new Set<(event: BrokerEvent) => void>();
  #server: WebSocketServer | undefined;
  #plugin: WebSocket | undefined;
  #pluginVersion: string | undefined;

  constructor(config: ServerConfig) {
    this.#config = config;
  }

  get connected(): boolean {
    return this.#plugin?.readyState === WebSocket.OPEN;
  }

  get pluginVersion(): string | undefined {
    return this.#pluginVersion;
  }

  onEvent(listener: (event: BrokerEvent) => void): () => void {
    this.#eventListeners.add(listener);
    return () => this.#eventListeners.delete(listener);
  }

  async start(): Promise<void> {
    if (this.#server) return;
    const server = new WebSocketServer({
      host: this.#config.host,
      port: this.#config.port,
      maxPayload: MAX_RPC_MESSAGE_BYTES,
      perMessageDeflate: false,
    });
    this.#server = server;
    server.on('connection', (socket) => this.#authenticate(socket));
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
  }

  async stop(): Promise<void> {
    this.#plugin?.close(1001, 'Server stopping');
    this.#rejectPending('PLUGIN_NOT_CONNECTED', 'Bridge server stopped');
    const server = this.#server;
    this.#server = undefined;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  async request<T = unknown>(
    method: string,
    params?: unknown,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    const socket = this.#plugin;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new BridgeFault({
        code: 'PLUGIN_NOT_CONNECTED',
        message: 'Start Local Figma Agent Bridge in Figma Desktop.',
        retryable: true,
      });
    }

    const id = randomUUID();
    const request: RpcRequest = {
      version: BRIDGE_PROTOCOL_VERSION,
      id,
      method,
      ...(params === undefined ? {} : { params }),
      timeoutMs,
    };

    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        this.#logRequest(id, method, Date.now() - startedAt, 'RPC_TIMEOUT');
        reject(
          new BridgeFault({
            code: 'RPC_TIMEOUT',
            message: `Figma RPC ${method} timed out after ${timeoutMs}ms.`,
            retryable: true,
          }),
        );
      }, timeoutMs);
      const startedAt = Date.now();
      this.#pending.set(id, {
        id,
        method,
        startedAt,
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      socket.send(JSON.stringify(request), (error) => {
        if (!error) return;
        const pending = this.#pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.#pending.delete(id);
        reject(error);
      });
    });
  }

  #authenticate(socket: WebSocket): void {
    const serverNonce = randomBytes(24).toString('base64url');
    let authenticated = false;
    const timer = setTimeout(() => socket.close(4001, 'Authentication timed out'), 5_000);

    socket.send(
      JSON.stringify({
        type: 'auth.challenge',
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        serverNonce,
      }),
    );

    socket.on('message', (data) => {
      if (authenticated) {
        this.#handlePluginMessage(data);
        return;
      }
      const parsed = AuthPluginProofSchema.safeParse(this.#parseJson(data));
      if (!parsed.success || parsed.data.serverNonce !== serverNonce) {
        this.#rejectSocket(socket, 'AUTH_FAILED', 'Invalid authentication response.');
        return;
      }
      if (this.connected) {
        this.#rejectSocket(socket, 'PLUGIN_ALREADY_CONNECTED', 'Another Figma plugin is active.');
        return;
      }
      const expected = createPluginProof(this.#config.secret, serverNonce, parsed.data.pluginNonce);
      if (!verifyProof(parsed.data.proof, expected)) {
        this.#rejectSocket(socket, 'AUTH_FAILED', 'Pairing secret is not valid.');
        return;
      }

      clearTimeout(timer);
      authenticated = true;
      this.#plugin = socket;
      this.#pluginVersion = parsed.data.pluginVersion;
      socket.send(
        JSON.stringify({
          type: 'auth.server-proof',
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          serverNonce,
          pluginNonce: parsed.data.pluginNonce,
          proof: createServerProof(this.#config.secret, serverNonce, parsed.data.pluginNonce),
        }),
      );
    });

    socket.on('close', () => {
      clearTimeout(timer);
      if (this.#plugin === socket) {
        this.#plugin = undefined;
        this.#pluginVersion = undefined;
        this.#rejectPending('PLUGIN_NOT_CONNECTED', 'Figma plugin disconnected.');
      }
    });
  }

  #handlePluginMessage(data: RawData): void {
    const value = this.#parseJson(data);
    const response = RpcResponseSchema.safeParse(value);
    if (response.success) {
      this.#resolveResponse(response.data);
      return;
    }
    const event = RpcEventSchema.safeParse(value);
    if (event.success) {
      for (const listener of this.#eventListeners) listener(event.data);
    }
  }

  #resolveResponse(response: RpcResponse): void {
    const pending = this.#pending.get(response.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.#pending.delete(response.id);
    if (response.ok) {
      this.#logRequest(pending.id, pending.method, Date.now() - pending.startedAt, 'OK');
      pending.resolve(response.result);
    } else {
      this.#logRequest(
        pending.id,
        pending.method,
        Date.now() - pending.startedAt,
        response.error.code,
      );
      pending.reject(new BridgeFault(response.error));
    }
  }

  #rejectSocket(socket: WebSocket, code: 'AUTH_FAILED' | 'PLUGIN_ALREADY_CONNECTED', message: string): void {
    socket.send(JSON.stringify({ type: 'auth.rejected', code, message }));
    socket.close(4003, message);
  }

  #rejectPending(code: 'PLUGIN_NOT_CONNECTED', message: string): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new BridgeFault({ code, message, retryable: true }));
    }
    this.#pending.clear();
  }

  #logRequest(id: string, method: string, durationMs: number, outcome: string): void {
    console.error(
      JSON.stringify({
        level: outcome === 'OK' ? 'info' : 'warn',
        event: 'figma_rpc',
        requestId: id,
        method,
        durationMs,
        outcome,
      }),
    );
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
}
