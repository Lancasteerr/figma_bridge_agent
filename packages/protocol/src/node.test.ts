import { describe, expect, it } from 'vitest';

import {
  LightweightTreeNodeSchema,
  NodeResultSchema,
  TreeCoverageSchema,
  TreeResultSchema,
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

  it('公开树只接受轻量边界，并以可选字段表达截断与临时文件', () => {
    const publicRoot = {
      id: '1:2',
      name: 'Hero',
      type: 'FRAME',
      bounds: { x: 0, y: 0, width: 100, height: 80 },
      childCount: 0,
      layoutMode: 'VERTICAL' as const,
      children: [],
    };
    expect(
      TreeResultSchema.safeParse({
        root: publicRoot,
      }).success,
    ).toBe(true);
    expect(
      TreeResultSchema.safeParse({
        root: publicRoot,
        artifact: {
          localPath: 'C:\\temp\\tree.jsonl',
          expiresAt: '2026-10-13T00:30:00.000Z',
          sha256: 'a'.repeat(64),
        },
      }).success,
    ).toBe(false);
  });
});

describe('节点保真协议', () => {
  it('接受布局、富文本和形状的稀疏扩展字段', () => {
    expect(
      NodeResultSchema.safeParse({
        name: 'Card',
        type: 'FRAME',
        geometry: {
          ...root.geometry,
          absoluteRenderBounds: { x: -4, y: -4, width: 108, height: 88 },
        },
        layout: {
          sizing: { horizontal: 'FILL', vertical: 'HUG', minWidth: 80 },
          item: { align: 'STRETCH', grow: 1 },
        },
        text: {
          characters: 'Hello',
          truncated: false,
          runs: [{ start: 0, end: 5, fontSize: 16 }],
        },
        visual: {
          strokeAlign: 'OUTSIDE',
          dashPattern: [4, 2],
          cornerRadii: { topLeft: 4, topRight: 8, bottomRight: 12, bottomLeft: 16 },
        },
        children: [],
        snapshotFingerprint: 'snapshot-123',
      }).success,
    ).toBe(true);
  });

  it('拒绝超过六十四个富文本样式区间', () => {
    const runs = Array.from({ length: 65 }, (_, index) => ({
      start: index,
      end: index + 1,
      fontSize: 16,
    }));
    expect(
      NodeResultSchema.safeParse({
        name: 'Text',
        type: 'TEXT',
        text: { characters: 'x'.repeat(65), truncated: false, runs },
        children: [],
        snapshotFingerprint: 'snapshot-123',
      }).success,
    ).toBe(false);
  });
});
