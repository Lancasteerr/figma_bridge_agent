export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** 将 Figma 对象归一化为有限深度、无函数、可 JSON 序列化的值。 */
export function toJsonValue(value: unknown, depth = 0, seen = new WeakSet<object>()): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  // 非有限数字、symbol、函数和循环引用都必须转换，否则指纹和 MCP JSON 会失真或失败。
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'symbol') return 'mixed';
  if (typeof value === 'undefined' || typeof value === 'function') return null;
  if (depth >= 8) return '[max-depth]';
  if (Array.isArray(value)) return value.map((item) => toJsonValue(item, depth + 1, seen));
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  const result: Record<string, JsonValue> = {};
  for (const key of Object.keys(value).sort()) {
    const entry = Reflect.get(value, key) as unknown;
    if (typeof entry !== 'function' && typeof entry !== 'undefined') {
      result[key] = toJsonValue(entry, depth + 1, seen);
    }
  }
  seen.delete(value);
  return result;
}
