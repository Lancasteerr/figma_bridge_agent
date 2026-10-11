import { describe, expect, it } from 'vitest';

import {
  ExportSemanticScopeInputSchema,
  SemanticFactRecordSchema,
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
});
