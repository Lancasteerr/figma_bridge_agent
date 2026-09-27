import { randomBytes, randomUUID } from 'node:crypto';

import {
  AuthChallengeSchema,
  BRIDGE_PROTOCOL_VERSION,
  BridgeFault,
  DaemonAuthChallengeSchema,
  DaemonAuthRejectedSchema,
  DaemonServerProofSchema,
  DaemonStateSchema,
  DEFAULT_REQUEST_TIMEOUT_MS,
  RpcEventSchema,
  RpcResponseSchema,
  type DaemonState,
  type RpcResponse,
} from '@figma-agent/protocol';
import { WebSocket, type RawData } from 'ws';

import type { ServerConfig } from '../config/store.js';
import {
  createDaemonClientProof,
  createDaemonServerProof,
  verifyProof,
} from '../security/proof.js';
import { spawnBridgeDaemon } from './daemon-process.js';
import type { BridgeEvent, BridgeTransport } from './transport.js';

interface PendingRequest {
  resolve(value: unknown): void;
  reject(reason: unknown): void;
  timer: NodeJS.Timeout;
}

export type DaemonFailureKind =
  'stopped' | 'legacy' | 'port-occupied' | 'auth-failed' | 'protocol-mismatch';

export interface DaemonBridgeClientOptions {
  autoStart?: boolean;
  connectTimeoutMs?: number;
  spawnDaemon?: () => void;
}

/** stdio MCP 进程使用的可重连客户端；它从不直接占用插件监听端口。 */
export class DaemonBridgeClient implements BridgeTransport {
  readonly #config: ServerConfig;
  readonly #eventListeners = new Set<(event: BridgeEvent) => void>();
  readonly #pending = new Map<string, PendingRequest>();
  readonly #autoStart: boolean;
  readonly #connectTimeoutMs: number;
  readonly #spawnDaemon: () => void;
  #socket: WebSocket | undefined;
  #state: DaemonState | undefined;
  #connecting: Promise<void> | undefined;
  #retryTimer: NodeJS.Timeout | undefined;
  #retry = 0;
  #lastSpawnAt = 0;
  #closed = false;
  #authenticated = false;
  #lastFailure: DaemonFailureKind = 'stopped';

  constructor(config: ServerConfig, options: DaemonBridgeClientOptions = {}) {
    this.#config = config;
    this.#autoStart = options.autoStart ?? true;
    this.#connectTimeoutMs = options.connectTimeoutMs ?? 3_000;
    this.#spawnDaemon = options.spawnDaemon ?? spawnBridgeDaemon;
  }

  get connected(): boolean {
    return this.#state?.pluginConnected ?? false;
  }

  get pluginVersion(): string | undefined {
    return this.#state?.pluginVersion;
  }

  get daemonConnected(): boolean {
    return this.#authenticated && this.#socket?.readyState === WebSocket.OPEN;
  }

  get daemonState(): DaemonState | undefined {
    return this.#state;
  }

  get lastFailure(): DaemonFailureKind {
    return this.#lastFailure;
  }

  /** 启动后台连接，不让 Daemon 状态阻塞 MCP 工具注册。 */
  start(): void {
    if (this.#closed) return;
    void this.#ensureConnected().catch(() => undefined);
  }

  onEvent(listener: (event: BridgeEvent) => void): () => void {
    this.#eventListeners.add(listener);
    return () => this.#eventListeners.delete(listener);
  }

  async request<T = unknown>(
    method: string,
    params?: unknown,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    try {
      await this.waitUntilReady(this.#connectTimeoutMs);
    } catch {
      throw this.#unavailableFault();
    }
    const socket = this.#socket;
    if (!socket || socket.readyState !== WebSocket.OPEN || !this.#authenticated) {
      throw this.#unavailableFault();
    }
    const id = randomUUID();
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(
          new BridgeFault({
            code: 'RPC_TIMEOUT',
            message: `Bridge daemon RPC ${method} timed out after ${timeoutMs}ms.`,
            retryable: true,
          }),
        );
      }, timeoutMs);
      this.#pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      socket.send(
        JSON.stringify({
          version: BRIDGE_PROTOCOL_VERSION,
          id,
          method,
          ...(params === undefined ? {} : { params }),
          timeoutMs,
        }),
        (error) => {
          if (!error) return;
          const pending = this.#pending.get(id);
          if (!pending) return;
          clearTimeout(pending.timer);
          this.#pending.delete(id);
          reject(this.#unavailableFault());
        },
      );
    });
  }

  async waitUntilReady(timeoutMs = this.#connectTimeoutMs): Promise<void> {
    if (this.daemonConnected) return;
    const connecting = this.#ensureConnected();
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        connecting,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Daemon connection timed out.')), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
    if (this.#retryTimer) clearTimeout(this.#retryTimer);
    this.#retryTimer = undefined;
    this.#rejectPending();
    this.#authenticated = false;
    this.#state = undefined;
    if (this.#socket?.readyState === WebSocket.OPEN) {
      this.#socket.close(1000, 'MCP client stopping');
    } else {
      this.#socket?.terminate();
    }
    this.#socket = undefined;
  }

  #ensureConnected(): Promise<void> {
    if (this.daemonConnected) return Promise.resolve();
    if (this.#connecting) return this.#connecting;
    this.#connecting = this.#connectWithStartup().finally(() => {
      this.#connecting = undefined;
    });
    return this.#connecting;
  }

  async #connectWithStartup(): Promise<void> {
    try {
      await this.#connectOnce();
      return;
    } catch (error) {
      if (!this.#autoStart || this.#closed || this.#isTerminalFailure()) throw error;
      this.#startDaemonWithCooldown();
    }

    const deadline = Date.now() + this.#connectTimeoutMs;
    let lastError: unknown;
    while (!this.#closed && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 75));
      try {
        await this.#connectOnce();
        return;
      } catch (error) {
        lastError = error;
        if (this.#isTerminalFailure()) throw error;
      }
    }
    this.#scheduleReconnect();
    throw lastError ?? new Error('Bridge daemon did not become ready.');
  }

  #connectOnce(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://${this.#config.host}:${this.#config.port}/mcp`);
      this.#socket = socket;
      this.#authenticated = false;
      let settled = false;
      let daemonNonce = '';
      let clientNonce = '';
      const finishError = (error: Error): void => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      };
      const timer = setTimeout(() => {
        this.#lastFailure = 'port-occupied';
        socket.close();
        finishError(new Error('Daemon authentication timed out.'));
      }, this.#connectTimeoutMs);

      socket.on('message', (data) => {
        const value = this.#parseJson(data);
        if (!this.#authenticated) {
          const legacy = AuthChallengeSchema.safeParse(value);
          if (legacy.success) {
            this.#lastFailure = 'legacy';
            socket.close(4002, 'Legacy bridge server detected');
            finishError(new Error('Legacy bridge server detected.'));
            return;
          }
          const challenge = DaemonAuthChallengeSchema.safeParse(value);
          if (challenge.success) {
            daemonNonce = challenge.data.daemonNonce;
            clientNonce = randomBytes(24).toString('base64url');
            socket.send(
              JSON.stringify({
                type: 'daemon.auth.client-proof',
                protocolVersion: BRIDGE_PROTOCOL_VERSION,
                daemonNonce,
                clientNonce,
                proof: createDaemonClientProof(this.#config.secret, daemonNonce, clientNonce),
                clientVersion: '0.1.0',
              }),
            );
            return;
          }
          const proof = DaemonServerProofSchema.safeParse(value);
          if (proof.success) {
            const expected = createDaemonServerProof(this.#config.secret, daemonNonce, clientNonce);
            if (!verifyProof(proof.data.proof, expected)) {
              this.#lastFailure = 'auth-failed';
              socket.close(4003, 'Daemon server proof failed');
              finishError(new Error('Daemon server proof failed.'));
              return;
            }
            clearTimeout(timer);
            this.#authenticated = true;
            this.#lastFailure = 'stopped';
            this.#retry = 0;
            if (!settled) {
              settled = true;
              resolve();
            }
            return;
          }
          const rejection = DaemonAuthRejectedSchema.safeParse(value);
          if (rejection.success) {
            this.#lastFailure =
              rejection.data.code === 'PROTOCOL_MISMATCH' ? 'protocol-mismatch' : 'auth-failed';
            socket.close(4003, rejection.data.code);
            finishError(new Error(rejection.data.message));
          }
          return;
        }
        this.#handleMessage(value);
      });
      socket.once('error', (error) => {
        clearTimeout(timer);
        if (this.#lastFailure !== 'legacy') {
          const code = 'code' in error ? String(error.code) : '';
          this.#lastFailure = code === 'ECONNREFUSED' ? 'stopped' : 'port-occupied';
        }
        finishError(error);
      });
      socket.once('unexpected-response', (_request, response) => {
        clearTimeout(timer);
        this.#lastFailure = 'port-occupied';
        response.destroy();
        finishError(new Error('Bridge port returned a non-WebSocket response.'));
      });
      socket.once('close', () => {
        clearTimeout(timer);
        if (this.#socket === socket) this.#socket = undefined;
        const wasAuthenticated = this.#authenticated;
        this.#authenticated = false;
        this.#state = undefined;
        this.#rejectPending();
        if (!settled) finishError(new Error('Daemon connection closed.'));
        if (wasAuthenticated && !this.#closed) this.#scheduleReconnect();
      });
    });
  }

  #handleMessage(value: unknown): void {
    const state = DaemonStateSchema.safeParse(value);
    if (state.success) {
      this.#state = state.data;
      return;
    }
    const response = RpcResponseSchema.safeParse(value);
    if (response.success) {
      this.#settleResponse(response.data);
      return;
    }
    const event = RpcEventSchema.safeParse(value);
    if (event.success) {
      for (const listener of this.#eventListeners) listener(event.data);
    }
  }

  #settleResponse(response: RpcResponse): void {
    const pending = this.#pending.get(response.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.#pending.delete(response.id);
    if (response.ok) pending.resolve(response.result);
    else pending.reject(new BridgeFault(response.error));
  }

  #scheduleReconnect(): void {
    if (this.#closed || this.#retryTimer) return;
    const delay = Math.min(10_000, 250 * 2 ** this.#retry) + Math.floor(Math.random() * 100);
    this.#retry += 1;
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = undefined;
      void this.#ensureConnected().catch(() => this.#scheduleReconnect());
    }, delay);
  }

  #startDaemonWithCooldown(): void {
    if (Date.now() - this.#lastSpawnAt < 1_000) return;
    this.#lastSpawnAt = Date.now();
    this.#spawnDaemon();
  }

  #rejectPending(): void {
    const error = this.#unavailableFault();
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }

  #unavailableFault(): BridgeFault {
    return new BridgeFault({
      code: 'BRIDGE_UNAVAILABLE',
      message: `Figma bridge daemon is unavailable (${this.#lastFailure}).`,
      retryable: this.#lastFailure !== 'auth-failed' && this.#lastFailure !== 'protocol-mismatch',
      details: { state: this.#lastFailure },
    });
  }

  #isTerminalFailure(): boolean {
    return (
      this.#lastFailure === 'legacy' ||
      this.#lastFailure === 'auth-failed' ||
      this.#lastFailure === 'protocol-mismatch'
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
