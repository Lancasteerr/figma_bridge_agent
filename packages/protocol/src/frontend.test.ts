import { describe, expect, it } from 'vitest';

import {
  IndexScopeInputSchema,
  PrepareWorkunitInputSchema,
  ScopeTruncationSchema,
  WorkunitFactRecordSchema,
  WorkunitImplementationSchema,
  WorkunitIdInputSchema,
  WorkunitSourceManifestSchema,
} from './frontend.js';

describe('前端 workunit 协议', () => {
  const sessionId = '11111111-1111-4111-8111-111111111111';

  it('结构索引和实施准备使用不同且无 profile 的输入', () => {
    expect(
      IndexScopeInputSchema.parse({ rootNodeId: '84:681', expectedSessionId: sessionId }),
    ).toMatchObject({ depth: 8, maxNodes: 200, maxTextLength: 500 });
    expect(
      PrepareWorkunitInputSchema.parse({ rootNodeId: '84:681', expectedSessionId: sessionId }),
    ).toMatchObject({ includePreview: false, fidelityPolicy: 'EXACT' });
    expect(
      PrepareWorkunitInputSchema.safeParse({
        rootNodeId: '84:681',
        expectedSessionId: sessionId,
        profile: 'IMPLEMENTATION',
      }).success,
    ).toBe(false);
  });

  it('实施事实不接受旧字段或嵌套 children', () => {
    const base = {
      nodeId: 'node',
      parentId: null,
      depth: 0,
      order: 0,
      name: 'Card',
      type: 'FRAME',
    };
    expect(
      WorkunitFactRecordSchema.safeParse({
        ...base,
        bounds: {
          inParent: { x: 0, y: 0, width: 10, height: 10 },
          onPage: { x: 0, y: 0, width: 10, height: 10 },
        },
      }).success,
    ).toBe(true);
    for (const legacy of [{ geometry: {} }, { visual: {} }, { assets: {} }, { children: [] }]) {
      expect(WorkunitFactRecordSchema.safeParse({ ...base, ...legacy }).success).toBe(false);
    }
  });

  it('workunit 实施骨架固定保存映射和实施状态', () => {
    expect(
      WorkunitImplementationSchema.parse({
        sourceFingerprint: '12345678',
        fidelityPolicy: 'EXACT',
        state: 'PLANNED',
        targetFiles: [],
        mappings: {},
        assumptions: [],
        unresolvedDifferences: [],
      }),
    ).toMatchObject({ state: 'PLANNED', mappings: {} });
  });

  it('来源检查只接受 workUnitId', () => {
    const input = { workUnitId: 'workunit-1234567890abcdef' };
    expect(WorkunitIdInputSchema.parse(input)).toEqual(input);
    expect(WorkunitIdInputSchema.safeParse({ ...input, rootNodeId: '84:681' }).success).toBe(false);
  });

  it('来源 manifest 始终包含 facts 且不接受旧 profile', () => {
    const manifest = {
      schemaVersion: 3 as const,
      kind: 'WORKUNIT_SOURCE' as const,
      normalization: 'COMPACT_V2' as const,
      sessionId,
      workUnitId: 'workunit-1234567890abcdef',
      rootNodeId: '84:681',
      rootNodeName: 'Root',
      page: { id: 'page:1', name: 'Home' },
      request: {
        rootNodeId: '84:681',
        factNodeIds: [],
        includePreview: false,
        depth: 8,
        maxNodes: 200,
        maxTextLength: 500,
      },
      sourceFingerprint: '12345678',
      nodeCount: 1,
      evidenceComplete: true,
      truncation: null,
      files: { outline: 'outline.jsonl' as const, facts: 'facts.jsonl' as const },
      sha256: { outline: 'a'.repeat(64), facts: 'b'.repeat(64) },
      createdAt: '2026-10-15T00:00:00.000Z',
    };
    expect(WorkunitSourceManifestSchema.safeParse(manifest).success).toBe(true);
    expect(
      WorkunitSourceManifestSchema.safeParse({ ...manifest, profile: 'IMPLEMENTATION' }).success,
    ).toBe(false);
  });

  it('结构化截断保留原因、前沿和遗漏数量', () => {
    expect(
      ScopeTruncationSchema.parse({
        reasons: ['NODE_LIMIT'],
        frontierNodeIds: ['child:2'],
        omittedChildCount: 1,
      }),
    ).toEqual({
      reasons: ['NODE_LIMIT'],
      frontierNodeIds: ['child:2'],
      omittedChildCount: 1,
    });
  });
});
