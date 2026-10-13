import { describe, expect, it } from 'vitest';

import { BridgeFault } from '@figma-agent/protocol';

import { structuredResult, toolError } from './result.js';

describe('MCP 工具结果边界', () => {
  it('成功结果只返回一份结构化内容', () => {
    const value = { nodeId: '1:2', nested: { count: 3 } };

    expect(structuredResult(value)).toEqual({ content: [], structuredContent: value });
  });

  it('错误结果只返回归一化后的短文本', () => {
    const result = toolError(new Error('failed'));

    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.text).toContain('failed');
    expect(result).not.toHaveProperty('structuredContent');
  });

  it('错误结果不会暴露摘要或内部路径', () => {
    const result = toolError(
      new BridgeFault({
        code: 'EXPORT_TARGET_CONFLICT',
        message: 'conflict',
        retryable: true,
        details: { existingSha256: 'a'.repeat(64), rootPath: 'C:\\secret' },
      }),
    );

    expect(result.content[0]?.text).not.toContain('existingSha256');
    expect(result.content[0]?.text).not.toContain('C:\\secret');
  });
});
