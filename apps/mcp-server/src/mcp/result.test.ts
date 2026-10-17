import { describe, expect, it, vi } from 'vitest';

import { BridgeFault } from '@figma-agent/protocol';

import { structuredResult, toolError } from './result.js';

describe('MCP 工具结果边界', () => {
  it('成功结果只返回一份结构化内容', () => {
    const value = { nodeId: '1:2', nested: { count: 3 } };

    expect(structuredResult(value)).toEqual({ content: [], structuredContent: value });
  });

  it('未知异常只向本地记录原文并返回通用错误', () => {
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = toolError(new Error('failed at C:\\secret with beforeFingerprint=12345678'));

    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.text).toContain('Internal bridge error.');
    expect(result.content[0]?.text).not.toContain('C:\\secret');
    expect(result.content[0]?.text).not.toContain('beforeFingerprint');
    expect(diagnostic).toHaveBeenCalledOnce();
    expect(result).not.toHaveProperty('structuredContent');
    diagnostic.mockRestore();
  });

  it('错误结果不会暴露摘要或内部路径', () => {
    const result = toolError(
      new BridgeFault({
        code: 'EXPORT_TARGET_CONFLICT',
        message: 'conflict',
        retryable: true,
        details: {
          existingSha256: 'a'.repeat(64),
          rootPath: 'C:\\secret',
          beforeFingerprint: '12345678',
          afterFingerprint: '87654321',
        },
      }),
    );

    expect(result.content[0]?.text).not.toContain('existingSha256');
    expect(result.content[0]?.text).not.toContain('C:\\secret');
    expect(result.content[0]?.text).not.toContain('beforeFingerprint');
    expect(result.content[0]?.text).not.toContain('afterFingerprint');
  });
});
