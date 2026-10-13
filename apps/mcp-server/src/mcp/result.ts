import { toBridgeError } from '@figma-agent/protocol';

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
  const error = toBridgeError(value);
  const details = publicErrorDetails(error.code, error.details);
  const publicError = {
    code: error.code,
    message: error.message,
    retryable: error.retryable,
    ...(error.nodeId ? { nodeId: error.nodeId } : {}),
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
