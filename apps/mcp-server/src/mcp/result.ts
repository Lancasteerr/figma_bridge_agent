import { toBridgeError } from '@figma-agent/protocol';

/** 同时返回 MCP 文本回退和结构化内容，兼容只理解 text 的客户端。 */
export function structuredResult<T extends Record<string, unknown>>(value: T) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

/** 将任意异常转换为稳定的 MCP error payload，不把原始异常对象直接跨边界暴露。 */
export function toolError(value: unknown) {
  const error = toBridgeError(value);
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error }) }],
    isError: true,
  };
}
