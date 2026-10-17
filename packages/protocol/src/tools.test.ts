import { describe, expect, it } from 'vitest';

import {
  BindExportRootInputSchema,
  BindExportRootResultSchema,
  DuplicateProposalInputSchema,
  ExportAssetsInputSchema,
  ExportAssetRpcInputSchema,
  GetFingerprintInputSchema,
  GetNodeInputSchema,
  GetRawNodeInputSchema,
  GetTreeInputSchema,
  GetTreeRpcInputSchema,
  RenderResultSchema,
  RenderRpcResultSchema,
  ValidateDesignPlanInputSchema,
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

  it('只返回规范化后的工作区根路径', () => {
    expect(
      BindExportRootResultSchema.safeParse({
        rootPath: 'E:\\workspace\\project',
      }).success,
    ).toBe(true);
    expect(
      BindExportRootResultSchema.safeParse({
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

describe('compact node input', () => {
  it('默认选择除 DIRECT_CHILDREN 外的事实字段组', () => {
    expect(GetNodeInputSchema.parse({ nodeId: '1:2' })).toEqual({
      nodeId: '1:2',
      fields: ['BOUNDS', 'LAYOUT', 'TEXT', 'APPEARANCE', 'ASSET_SOURCES', 'COMPONENT'],
    });
  });

  it('接受显式空投影和 DIRECT_CHILDREN，并拒绝重复字段', () => {
    expect(GetNodeInputSchema.parse({ nodeId: '1:2', fields: [] }).fields).toEqual([]);
    expect(GetNodeInputSchema.parse({ nodeId: '1:2', fields: ['DIRECT_CHILDREN'] }).fields).toEqual(
      ['DIRECT_CHILDREN'],
    );
    expect(GetNodeInputSchema.safeParse({ nodeId: '1:2', fields: ['TEXT', 'TEXT'] }).success).toBe(
      false,
    );
  });
});

describe('DesignPlan returnRefs input', () => {
  const request = {
    plan: {
      version: 1 as const,
      proposal: { name: 'Proposal' },
      root: {
        kind: 'FRAME' as const,
        ref: 'root',
        name: 'Root',
        geometry: { width: 100, height: 100 },
        children: [],
      },
    },
  };

  it('接受空值和不重复的按需引用', () => {
    expect(ValidateDesignPlanInputSchema.safeParse(request).success).toBe(true);
    expect(
      ValidateDesignPlanInputSchema.safeParse({ ...request, returnRefs: ['root'] }).success,
    ).toBe(true);
  });

  it('拒绝重复引用和超过二百个引用', () => {
    expect(
      ValidateDesignPlanInputSchema.safeParse({ ...request, returnRefs: ['root', 'root'] }).success,
    ).toBe(false);
    expect(
      ValidateDesignPlanInputSchema.safeParse({
        ...request,
        returnRefs: Array.from({ length: 201 }, (_, index) => `ref-${index}`),
      }).success,
    ).toBe(false);
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
        localPath: 'C:\\temp\\preview.png',
        pixelWidth: 100,
        pixelHeight: 80,
        expiresAt: '2026-10-13T00:30:00.000Z',
      }).success,
    ).toBe(true);
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

describe('raw node projection input', () => {
  it('默认只读取自节点并使用二百五十六 KiB 上限', () => {
    expect(GetRawNodeInputSchema.parse({ nodeId: '1:2' })).toEqual({
      nodeId: '1:2',
      depth: 0,
      maxBytes: 256 * 1024,
    });
  });

  it('接受唯一的普通顶层字段和一层 children', () => {
    expect(
      GetRawNodeInputSchema.parse({ nodeId: '1:2', depth: 1, fields: ['reactions', 'styles'] }),
    ).toMatchObject({ depth: 1, fields: ['reactions', 'styles'] });
  });

  it('拒绝保留字段、重复字段、过深读取和超过二 MiB 的上限', () => {
    for (const fields of [['children'], ['id'], ['reactions', 'reactions'], ['__proto__']]) {
      expect(GetRawNodeInputSchema.safeParse({ nodeId: '1:2', fields }).success).toBe(false);
    }
    expect(GetRawNodeInputSchema.safeParse({ nodeId: '1:2', depth: 2 }).success).toBe(false);
    expect(
      GetRawNodeInputSchema.safeParse({ nodeId: '1:2', maxBytes: 2 * 1024 * 1024 + 1 }).success,
    ).toBe(false);
  });
});

describe('asset export input', () => {
  const workUnitId = 'workunit-1234567890abcdef';

  it('接受带 workunit 守卫的 RAW+SVG 批次，并从插件 RPC 移除本地交付字段', () => {
    const input = {
      workUnitId,
      items: [
        {
          nodeId: 'node:1',
          mode: 'RAW' as const,
          paintSlot: 'FILLS' as const,
          paintIndex: 0,
          outputPathStem: 'src/assets/avatar',
        },
        {
          nodeId: 'node:2',
          mode: 'RENDERED' as const,
          format: 'SVG' as const,
          outputPath: 'src/assets/logo.svg',
        },
      ],
    };
    expect(ExportAssetsInputSchema.parse(input)).toMatchObject({
      workUnitId,
      items: [{ writePolicy: 'REUSE_OR_FAIL' }, { writePolicy: 'REUSE_OR_FAIL' }],
    });
    expect(
      ExportAssetsInputSchema.safeParse({
        sourceGuard: { rootNodeId: 'root', expectedSourceFingerprint: '12345678' },
        items: input.items,
      }).success,
    ).toBe(false);
    expect(
      ExportAssetRpcInputSchema.safeParse({
        nodeId: 'node:1',
        mode: 'RAW',
        paintSlot: 'FILLS',
        paintIndex: 0,
      }).success,
    ).toBe(true);
  });

  it('拒绝绝对/越界路径、带扩展名的 RAW stem 和超过 32 项', () => {
    const base = {
      nodeId: 'node:1',
      mode: 'RAW' as const,
      paintSlot: 'FILLS' as const,
      paintIndex: 0,
    };
    for (const outputPathStem of ['C:\\temp\\avatar', '../avatar', '/tmp/avatar', 'a.png']) {
      expect(
        ExportAssetsInputSchema.safeParse({ workUnitId, items: [{ ...base, outputPathStem }] })
          .success,
      ).toBe(false);
    }
    expect(
      ExportAssetsInputSchema.safeParse({
        workUnitId,
        items: Array.from({ length: 33 }, (_, index) => ({
          ...base,
          outputPathStem: `assets/${index}`,
        })),
      }).success,
    ).toBe(false);
  });

  it('拒绝 SVG scale 和渲染格式扩展名不匹配', () => {
    expect(
      ExportAssetsInputSchema.safeParse({
        workUnitId,
        items: [
          {
            nodeId: 'node:1',
            mode: 'RENDERED',
            format: 'SVG',
            scale: 2,
            outputPath: 'src/assets/logo.svg',
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      ExportAssetsInputSchema.safeParse({
        workUnitId,
        items: [
          {
            nodeId: 'node:1',
            mode: 'RENDERED',
            format: 'PNG',
            outputPath: 'src/assets/logo.svg',
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('显式覆盖仍要求调用方检查过现有文件摘要', () => {
    expect(
      ExportAssetsInputSchema.safeParse({
        workUnitId,
        items: [
          {
            nodeId: 'node:1',
            mode: 'RENDERED',
            format: 'PNG',
            outputPath: 'src/assets/image.png',
            writePolicy: 'OVERWRITE',
          },
        ],
      }).success,
    ).toBe(false);
  });
});
