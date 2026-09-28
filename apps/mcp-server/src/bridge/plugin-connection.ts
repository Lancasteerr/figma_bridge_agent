import { randomBytes, randomUUID } from 'node:crypto';

import {
  AuthPluginProofSchema,
  BRIDGE_PROTOCOL_VERSION,
  BridgeFault,
  DEFAULT_REQUEST_TIMEOUT_MS,
  RpcEventSchema,
  RpcResponseSchema,
  type RpcRequest,
  type RpcResponse,
} from '@figma-agent/protocol';
import { WebSocket, type RawData } from 'ws';

import type { ServerConfig } from '../config/store.js';
import { updateConfig } from '../config/store.js';
import { createPluginProof, createServerProof, verifyProof } from '../security/proof.js';
import type { BridgeEvent, BridgeTransport } from './transport.js';

interface PendingRequest {
  /** 这些字段同时用于响应匹配、超时清理和脱敏诊断日志。 */
  id: string;
  method: string;
  startedAt: number;
  resolve(value: unknown): void;
  reject(reason: unknown): void;
  timer: NodeJS.Timeout;
}

export class PluginConnectionBroker implements BridgeTransport {
  readonly #config: ServerConfig;
  readonly #configPath: string | undefined;
  readonly #log: (entry: Record<string, unknown>) => void;
  readonly #pending = new Map<string, PendingRequest>();
  readonly #eventListeners = new Set<(event: BridgeEvent) => void>();
  readonly #stateListeners = new Set<() => void>();
  #plugin: WebSocket | undefined;
  #pluginVersion: string | undefined;
  #deviceId: string | undefined;

  constructor(
    config: ServerConfig,
    log: (entry: Record<string, unknown>) => void = (entry) => console.error(JSON.stringify(entry)),
    options: { configPath?: string } = {},
  ) {
    this.#config = config;
    this.#log = log;
    this.#configPath = options.configPath;
  }

  /** 当前是否存在已经完成鉴权且仍处于 OPEN 状态的插件。 */
  get connected(): boolean {
    return this.#plugin?.readyState === WebSocket.OPEN;
  }

  /** 最近一次认证成功的插件版本，未连接时返回 undefined。 */
  get pluginVersion(): string | undefined {
    return this.#pluginVersion;
  }

  get deviceId(): string | undefined {
    return this.#deviceId;
  }

  /** 撤销当前设备时立即切断活动连接，避免凭据在本次会话继续生效。 */
  revokeCurrentDevice(): void {
    this.#plugin?.close(4003, 'DEVICE_REVOKED');
  }

  /** Daemon 用该计数决定是否仍有必须等待的插件调用。 */
  get pendingCount(): number {
    return this.#pending.size;
  }

  /** 注册事件监听器并返回可撤销的取消函数。 */
  onEvent(listener: (event: BridgeEvent) => void): () => void {
    this.#eventListeners.add(listener);
    return () => this.#eventListeners.delete(listener);
  }

  /** 插件连接和 pending 数量变化时通知 Daemon 刷新状态与空闲计时。 */
  onStateChange(listener: () => void): () => void {
    this.#stateListeners.add(listener);
    return () => this.#stateListeners.delete(listener);
  }

  /** Gateway 接受连接后交给 Broker 完成挑战、鉴权和升级。 */
  accept(socket: WebSocket): void {
    this.#authenticate(socket);
  }

  /** 先拒绝所有挂起 RPC，再关闭插件连接，避免 Promise 永久等待。 */
  async stop(): Promise<void> {
    this.#plugin?.close(1001, 'Server stopping');
    this.#plugin = undefined;
    this.#pluginVersion = undefined;
    this.#deviceId = undefined;
    this.#rejectPending('PLUGIN_NOT_CONNECTED', 'Bridge server stopped');
    this.#notifyState();
  }

  /** 与抽象 BridgeTransport 对齐；旧调用仍可继续使用 stop。 */
  async close(): Promise<void> {
    await this.stop();
  }

  /** 向唯一已认证插件发送 RPC，并把响应生命周期登记到 #pending。 */
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
        // 超时必须从 pending 移除，否则迟到响应会继续占用内存并产生错误日志。
        this.#pending.delete(id);
        this.#notifyState();
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
      this.#notifyState();
      socket.send(JSON.stringify(request), (error) => {
        if (!error) return;
        const pending = this.#pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.#pending.delete(id);
        this.#notifyState();
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
        serverId: this.#config.serverId,
        serverNonce,
      }),
    );

    socket.on('message', (data) => {
      if (authenticated) {
        this.#handlePluginMessage(data);
        return;
      }
      const value = this.#parseJson(data);
      if (this.#hasWrongProtocol(value)) {
        this.#rejectSocket(
          socket,
          'PROTOCOL_MISMATCH',
          'Plugin protocol version is not supported.',
        );
        return;
      }
      const parsed = AuthPluginProofSchema.safeParse(value);
      if (!parsed.success || parsed.data.serverNonce !== serverNonce) {
        this.#rejectSocket(socket, 'AUTH_FAILED', 'Invalid authentication response.');
        return;
      }
      if (this.connected) {
        this.#rejectSocket(socket, 'PLUGIN_ALREADY_CONNECTED', 'Another Figma plugin is active.');
        return;
      }
      if (parsed.data.serverId !== this.#config.serverId) {
        this.#rejectSocket(socket, 'SERVER_CHANGED', 'The local bridge identity has changed.');
        return;
      }
      const device = this.#config.pairedClients[parsed.data.deviceId];
      if (!device) {
        this.#rejectSocket(socket, 'UNKNOWN_DEVICE', 'This plugin must be paired again.');
        return;
      }
      const expected = createPluginProof(
        device.token,
        this.#config.serverId,
        parsed.data.deviceId,
        serverNonce,
        parsed.data.pluginNonce,
      );
      // 只有 proof 校验成功后才把 socket 提升为可处理 RPC 的插件连接。
      if (!verifyProof(parsed.data.proof, expected)) {
        this.#rejectSocket(socket, 'AUTH_FAILED', 'Pairing secret is not valid.');
        return;
      }

      clearTimeout(timer);
      authenticated = true;
      this.#plugin = socket;
      this.#pluginVersion = parsed.data.pluginVersion;
      this.#deviceId = parsed.data.deviceId;
      this.#notifyState();
      socket.send(
        JSON.stringify({
          type: 'auth.server-proof',
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          serverId: this.#config.serverId,
          deviceId: parsed.data.deviceId,
          serverNonce,
          pluginNonce: parsed.data.pluginNonce,
          proof: createServerProof(
            device.token,
            this.#config.serverId,
            parsed.data.deviceId,
            serverNonce,
            parsed.data.pluginNonce,
          ),
        }),
      );
      void this.#touchDevice(parsed.data.deviceId, parsed.data.pluginVersion);
    });

    socket.on('close', () => {
      clearTimeout(timer);
      if (this.#plugin === socket) {
        this.#plugin = undefined;
        this.#pluginVersion = undefined;
        this.#deviceId = undefined;
        this.#rejectPending('PLUGIN_NOT_CONNECTED', 'Figma plugin disconnected.');
        this.#notifyState();
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
    this.#notifyState();
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

  #rejectSocket(
    socket: WebSocket,
    code:
      | 'AUTH_FAILED'
      | 'PROTOCOL_MISMATCH'
      | 'PLUGIN_ALREADY_CONNECTED'
      | 'UNKNOWN_DEVICE'
      | 'SERVER_CHANGED',
    message: string,
  ): void {
    socket.send(JSON.stringify({ type: 'auth.rejected', code, message }));
    socket.close(4003, message);
  }

  #rejectPending(code: 'PLUGIN_NOT_CONNECTED', message: string): void {
    // 断线和停止服务都走同一条清理路径，保证每个请求只结算一次。
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new BridgeFault({ code, message, retryable: true }));
    }
    this.#pending.clear();
    this.#notifyState();
  }

  #notifyState(): void {
    for (const listener of this.#stateListeners) listener();
  }

  #logRequest(id: string, method: string, durationMs: number, outcome: string): void {
    this.#log({
      level: outcome === 'OK' ? 'info' : 'warn',
      event: 'figma_rpc',
      requestId: id,
      method,
      durationMs,
      outcome,
    });
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

  #hasWrongProtocol(value: unknown): boolean {
    return (
      typeof value === 'object' &&
      value !== null &&
      'type' in value &&
      value.type === 'auth.plugin-proof' &&
      'protocolVersion' in value &&
      value.protocolVersion !== BRIDGE_PROTOCOL_VERSION
    );
  }

  async #touchDevice(deviceId: string, pluginVersion: string): Promise<void> {
    try {
      if (!this.#configPath) {
        const device = this.#config.pairedClients[deviceId];
        if (device) {
          device.lastSeenAt = new Date().toISOString();
          device.pluginVersion = pluginVersion;
        }
        return;
      }
      const updated = await updateConfig((config) => {
        const device = config.pairedClients[deviceId];
        if (!device) return config;
        return {
          ...config,
          pairedClients: {
            ...config.pairedClients,
            [deviceId]: { ...device, lastSeenAt: new Date().toISOString(), pluginVersion },
          },
        };
      }, this.#configPath);
      Object.assign(this.#config, updated);
    } catch (error) {
      this.#log({
        level: 'warn',
        event: 'device_last_seen_update_failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
