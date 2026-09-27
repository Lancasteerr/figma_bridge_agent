import { describe, expect, it } from 'vitest';

import { fingerprintValue, stableStringify } from '../src/main/serialization/fingerprint.js';
import { toJsonValue } from '../src/main/serialization/json.js';

// 指纹测试关注“规范化后等价”，而不是具体 hash 算法实现细节。
describe('normalized fingerprints', () => {
  it('is stable across object insertion order', () => {
    const left = toJsonValue({ name: 'Card', width: 320, layout: { gap: 8, mode: 'VERTICAL' } });
    const right = toJsonValue({ layout: { mode: 'VERTICAL', gap: 8 }, width: 320, name: 'Card' });
    expect(stableStringify(left)).toBe(stableStringify(right));
    expect(fingerprintValue(left)).toBe(fingerprintValue(right));
  });

  it('normalizes mixed, circular, and non-finite values without leaking objects', () => {
    // Figma mixed 值、循环引用和 NaN 都必须变成可安全传输的 JSON 值。
    const circular: Record<string, unknown> = { mixed: Symbol('mixed'), value: Number.NaN };
    circular.self = circular;
    expect(toJsonValue(circular)).toEqual({
      mixed: 'mixed',
      self: '[circular]',
      value: 'NaN',
    });
  });
});
