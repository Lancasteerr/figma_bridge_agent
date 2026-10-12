import { describe, expect, it } from 'vitest';

import {
  BindExportRootInputSchema,
  BindExportRootResultSchema,
  DuplicateProposalInputSchema,
  ExportAssetInputSchema,
  ExportAssetRpcInputSchema,
  GetFingerprintInputSchema,
  GetTreeInputSchema,
  GetTreeRpcInputSchema,
  RenderResultSchema,
  RenderRpcResultSchema,
} from './tools.js';

describe('export root binding contract', () => {
  it('accepts only a bounded path string and matching session UUID shape', () => {
    const input = {
      rootPath: 'E:\\workspace\\project',
      expectedSessionId: '11111111-1111-4111-8111-111111111111',
    };
    expect(BindExportRootInputSchema.parse(input)).toEqual(input);
    expect(BindExportRootInputSchema.safeParse({ ...input, extra: true }).success).toBe(false);
    expect(
      BindExportRootInputSchema.safeParse({ ...input, rootPath: 'x'.repeat(1_025) }).success,
    ).toBe(false);
  });

  it('returns only a WORKSPACE status without fallback expiry', () => {
    expect(
      BindExportRootResultSchema.safeParse({
        delivery: 'WORKSPACE',
        rootPath: 'E:\\workspace\\project',
        sessionId: '11111111-1111-4111-8111-111111111111',
      }).success,
    ).toBe(true);
    expect(
      BindExportRootResultSchema.safeParse({
        delivery: 'STAGED',
        rootPath: 'E:\\workspace\\project',
        sessionId: '11111111-1111-4111-8111-111111111111',
      }).success,
    ).toBe(false);
  });
});

describe('duplicate Proposal input', () => {
  it('accepts edit targets and rejects the removed nodeIds field', () => {
    expect(DuplicateProposalInputSchema.safeParse({ editTargetNodeIds: ['target'] }).success).toBe(
      true,
    );
    expect(DuplicateProposalInputSchema.safeParse({ nodeIds: ['target'] }).success).toBe(false);
  });
});

describe('aggregate fingerprint input', () => {
  it('accepts ordered unique node IDs', () => {
    expect(GetFingerprintInputSchema.parse({ nodeIds: ['root-b', 'root-a'] })).toEqual({
      nodeIds: ['root-b', 'root-a'],
    });
  });

  it('rejects empty and duplicate node IDs', () => {
    expect(GetFingerprintInputSchema.safeParse({ nodeIds: [] }).success).toBe(false);
    expect(GetFingerprintInputSchema.safeParse({ nodeIds: ['root', 'root'] }).success).toBe(false);
  });
});

describe('render result boundary', () => {
  const rpc = {
    nodeId: 'node:1',
    mimeType: 'image/png' as const,
    data: 'base64-payload',
    width: 100,
    height: 80,
    fingerprint: 'fingerprint',
  };

  it('内部 RPC 接受 base64，公开结果拒绝图片正文', () => {
    expect(RenderRpcResultSchema.safeParse(rpc).success).toBe(true);
    expect(
      RenderResultSchema.safeParse({
        ...rpc,
        localPath: 'C:\\temp\\preview.png',
        sha256: 'a'.repeat(64),
        bytes: 100,
        createdAt: '2026-10-13T00:00:00.000Z',
        expiresAt: '2026-10-13T00:30:00.000Z',
      }).success,
    ).toBe(false);
  });
});

describe('lightweight tree input', () => {
  it('公开输入包含交付策略，插件 RPC 输入会移除该字段', () => {
    const input = GetTreeInputSchema.parse({ nodeId: '1:2' });

    expect(input).toEqual({
      nodeId: '1:2',
      depth: 2,
      maxNodes: 200,
      maxTextLength: 80,
      delivery: 'AUTO',
    });
    expect(GetTreeRpcInputSchema.safeParse(input).success).toBe(false);
    expect(
      GetTreeRpcInputSchema.parse({
        nodeId: input.nodeId,
        depth: input.depth,
        maxNodes: input.maxNodes,
        maxTextLength: input.maxTextLength,
      }),
    ).not.toHaveProperty('delivery');
  });

  it('文本预览上限固定为八十字符且不允许无限内联模式', () => {
    expect(GetTreeInputSchema.safeParse({ nodeId: '1:2', maxTextLength: 81 }).success).toBe(false);
    expect(GetTreeInputSchema.safeParse({ nodeId: '1:2', delivery: 'INLINE' }).success).toBe(false);
  });
});

describe('asset export input', () => {
  const fingerprint = '12345678';

  it('accepts RAW and strips local delivery fields from the plugin RPC contract', () => {
    const input = {
      nodeId: 'node:1',
      mode: 'RAW',
      paintSlot: 'FILLS',
      paintIndex: 0,
      expectedImageHash: 'image-hash',
      expectedNodeFingerprint: fingerprint,
      outputPathStem: 'src/assets/avatar',
    };
    expect(ExportAssetInputSchema.parse(input)).toMatchObject({ writePolicy: 'REUSE_OR_FAIL' });
    expect(
      ExportAssetRpcInputSchema.safeParse({
        nodeId: input.nodeId,
        mode: input.mode,
        paintSlot: input.paintSlot,
        paintIndex: input.paintIndex,
        expectedImageHash: input.expectedImageHash,
        expectedNodeFingerprint: input.expectedNodeFingerprint,
      }).success,
    ).toBe(true);
  });

  it('rejects absolute/traversal paths and RAW stems with extensions', () => {
    const base = {
      nodeId: 'node:1',
      mode: 'RAW',
      paintSlot: 'FILLS',
      paintIndex: 0,
      expectedImageHash: 'image-hash',
      expectedNodeFingerprint: fingerprint,
    };
    for (const outputPathStem of ['C:\\temp\\avatar', '../avatar', '/tmp/avatar', 'a.png']) {
      expect(ExportAssetInputSchema.safeParse({ ...base, outputPathStem }).success).toBe(false);
    }
  });

  it('rejects SVG scale and rendered extension mismatches', () => {
    expect(
      ExportAssetInputSchema.safeParse({
        nodeId: 'node:1',
        mode: 'RENDERED',
        format: 'SVG',
        scale: 2,
        expectedTreeFingerprint: fingerprint,
        outputPath: 'src/assets/logo.svg',
      }).success,
    ).toBe(false);
    expect(
      ExportAssetInputSchema.safeParse({
        nodeId: 'node:1',
        mode: 'RENDERED',
        format: 'PNG',
        expectedTreeFingerprint: fingerprint,
        outputPath: 'src/assets/logo.svg',
      }).success,
    ).toBe(false);
  });

  it('requires a checked existing hash for explicit overwrite', () => {
    expect(
      ExportAssetInputSchema.safeParse({
        nodeId: 'node:1',
        mode: 'RENDERED',
        format: 'PNG',
        expectedTreeFingerprint: fingerprint,
        outputPath: 'src/assets/image.png',
        writePolicy: 'OVERWRITE',
      }).success,
    ).toBe(false);
  });
});
