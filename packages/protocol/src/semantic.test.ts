import { describe, expect, it } from 'vitest';

import {
  ExportSemanticScopeInputSchema,
  SemanticFactRecordSchema,
  SemanticSnapshotManifestSchema,
  SemanticTruncationSchema,
} from './semantic.js';

describe('语义快照协议', () => {
  it('为范围导出提供受限默认值', () => {
    expect(
      ExportSemanticScopeInputSchema.parse({
        rootNodeId: '84:681',
        profile: 'OUTLINE',
        expectedSessionId: '11111111-1111-4111-8111-111111111111',
      }),
    ).toMatchObject({
      includeRender: false,
      depth: 8,
      maxNodes: 200,
      maxTextLength: 500,
    });
  });

  it('详细事实不接受重复的 children 子树', () => {
    expect(() =>
      SemanticFactRecordSchema.parse({
        nodeId: 'node',
        parentId: null,
        depth: 0,
        order: 0,
        name: 'Card',
        type: 'FRAME',
        children: [],
      }),
    ).toThrow();
  });

  it('结构化截断保留原因、前沿和遗漏数量', () => {
    expect(
      SemanticTruncationSchema.parse({
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

  it('manifest v2 区分未请求与已写入的 facts', () => {
    const base = {
      schemaVersion: 2 as const,
      normalization: 'COMPACT_V1' as const,
      sessionId: '11111111-1111-4111-8111-111111111111',
      scopeId: 'scope-1',
      rootNodeId: '84:681',
      rootNodeName: 'Root',
      page: { id: 'page:1', name: 'Home' },
      request: {
        focusNodeIds: [],
        includeRender: false,
        depth: 8,
        maxNodes: 200,
        maxTextLength: 500,
      },
      sourceFingerprint: '12345678',
      nodeCount: 1,
      complete: true,
      truncation: null,
      createdAt: '2026-10-15T00:00:00.000Z',
    };
    expect(
      SemanticSnapshotManifestSchema.safeParse({
        ...base,
        profile: 'OUTLINE',
        factsStatus: 'NOT_REQUESTED',
        files: { outline: 'outline.jsonl' },
        sha256: { outline: 'a'.repeat(64) },
      }).success,
    ).toBe(true);
    expect(
      SemanticSnapshotManifestSchema.safeParse({
        ...base,
        profile: 'OUTLINE',
        factsStatus: 'NOT_REQUESTED',
        files: { outline: 'outline.jsonl', facts: 'facts.jsonl' },
        sha256: { outline: 'a'.repeat(64), facts: 'b'.repeat(64) },
      }).success,
    ).toBe(false);
  });
});
