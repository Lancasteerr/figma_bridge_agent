/** 插件事件在所有桥接实现之间使用同一结构，避免 MCP 工具依赖具体传输。 */
export interface BridgeEvent {
  event: string;
  sequence: number;
  payload: unknown;
}

/** MCP 工具只依赖该接口；本地 Broker 与 Daemon 客户端均可实现它。 */
export interface BridgeTransport {
  readonly connected: boolean;
  readonly pluginVersion: string | undefined;
  request<T = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<T>;
  onEvent(listener: (event: BridgeEvent) => void): () => void;
  close(): Promise<void>;
}
