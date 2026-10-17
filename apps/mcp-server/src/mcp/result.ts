import { BridgeFault, toBridgeError } from '@figma-agent/protocol';

/** 成功结果只保留一份结构化内容，避免同一 JSON 重复进入模型上下文。 */
export function structuredResult<T extends Record<string, unknown>>(value: T) {
  return {
    // MCP SDK 当前要求 content 字段存在；空数组不会制造文本副本。
    content: [],
    structuredContent: value,
  };
}

/** 将任意异常转换为稳定的 MCP error payload，不把原始异常对象直接跨边界暴露。 */
export function toolError(value: unknown) {
  if (!(value instanceof BridgeFault)) {
    // 未知异常仅写入本地诊断；MCP 客户端只接收稳定的通用错误。
    console.error('[figma-bridge] Unexpected MCP tool error:', value);
  }
  const error = toBridgeError(value);
  const internal = error.code === 'INTERNAL_ERROR';
  const details = publicErrorDetails(error.code, error.details);
  const publicError = {
    code: error.code,
    message: internal ? 'Internal bridge error.' : error.message,
    retryable: error.retryable,
    ...(!internal && error.nodeId ? { nodeId: error.nodeId } : {}),
    ...(details ? { details } : {}),
  };
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: publicError }) }],
    isError: true,
  };
}

/** 只允许会改变 Agent 恢复动作的有界诊断信息跨越 MCP 边界。 */
function publicErrorDetails(code: string, value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Record<string, unknown>;
  const allowed =
    code === 'PAYLOAD_TOO_LARGE' || code === 'LIMIT_EXCEEDED'
      ? ['bytes', 'maxBytes', 'maximumBytes', 'limit', 'maximum']
      : code === 'PROTOCOL_MISMATCH'
        ? ['expectedProtocolVersion', 'actualProtocolVersion', 'expectedVersion', 'actualVersion']
        : [];
  const entries = allowed
    .filter((key) => source[key] !== undefined)
    .map((key) => [key, source[key]] as const);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
