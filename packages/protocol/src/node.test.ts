import { describe, expect, it } from 'vitest';

import {
  DeliveredTreeResultSchema,
  LightweightTreeNodeSchema,
  TreeCoverageSchema,
} from './node.js';

const root = {
  id: '1:2',
  parentId: '0:1',
  order: 0,
  name: 'Hero',
  type: 'FRAME',
  visible: true,
  geometry: {
    local: { x: 0, y: 0, width: 100, height: 80 },
    absolute: { x: 0, y: 0, width: 100, height: 80 },
    rotation: 0,
  },
  childCount: 0,
  layoutMode: 'VERTICAL' as const,
  assetHints: {
    imagePaintCount: 0,
    exportSettingCount: 0,
    hasVector: false,
    isMask: false,
  },
  children: [],
};

describe('轻量树协议', () => {
  it('接受导航字段并拒绝完整视觉快照字段', () => {
    expect(LightweightTreeNodeSchema.safeParse(root).success).toBe(true);
    expect(LightweightTreeNodeSchema.safeParse({ ...root, visual: { opacity: 1 } }).success).toBe(
      false,
    );
  });

  it('要求覆盖状态和截断详情保持一致', () => {
    expect(TreeCoverageSchema.safeParse({ complete: true, nodeCount: 1 }).success).toBe(true);
    expect(TreeCoverageSchema.safeParse({ complete: false, nodeCount: 1 }).success).toBe(false);
    expect(
      TreeCoverageSchema.safeParse({
        complete: false,
        nodeCount: 1,
        truncation: {
          reasons: ['DEPTH_LIMIT'],
          frontierNodeIds: ['1:2'],
          omittedChildCount: 2,
        },
      }).success,
    ).toBe(true);
  });

  it('临时文件交付不能伪装成完整内联', () => {
    const base = {
      schemaVersion: 2 as const,
      scope: { rootNodeId: '1:2', requestedDepth: 2, maxNodes: 200 },
      coverage: { complete: true, nodeCount: 1 },
      root,
    };
    expect(
      DeliveredTreeResultSchema.safeParse({
        ...base,
        delivery: { mode: 'INLINE', inlineComplete: true, inlineNodeCount: 1 },
      }).success,
    ).toBe(true);
    expect(
      DeliveredTreeResultSchema.safeParse({
        ...base,
        delivery: { mode: 'TEMP_FILE', inlineComplete: true, inlineNodeCount: 1 },
      }).success,
    ).toBe(false);
  });
});
