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
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error }) }],
    isError: true,
  };
}
