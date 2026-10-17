import { type NodeSnapshot } from '@figma-agent/protocol';
import { describe, expect, it } from 'vitest';

import { projectCompactNode } from '../src/main/serialization/compact-node.js';

const bounds = { x: 0, y: 0, width: 100, height: 80 };
const snapshot: NodeSnapshot = {
  id: '1:2',
  name: 'Card',
  type: 'FRAME',
  parentId: 'page:1',
  pageId: 'page:1',
  visible: true,
  locked: false,
  geometry: {
    local: bounds,
    absolute: bounds,
    absoluteRenderBounds: bounds,
    rotation: 0,
  },
  layout: {
    mode: 'NONE',
    wrap: 'NO_WRAP',
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    positioning: 'AUTO',
    primaryAxisAlign: 'MIN',
    counterAxisAlign: 'MIN',
    constraints: { horizontal: 'MIN', vertical: 'MIN' },
    overflow: { direction: 'VERTICAL', fixedChildCount: 1 },
  },
  text: {
    characters: 'Hello',
    truncated: false,
    letterSpacing: { value: 0, unit: 'PIXELS' },
    textAlignHorizontal: 'LEFT',
    textAlignVertical: 'TOP',
    textAutoResize: 'NONE',
    textTruncation: 'DISABLED',
    maxLines: null,
    paragraphIndent: 0,
    paragraphSpacing: 0,
    listSpacing: 0,
    textCase: 'ORIGINAL',
    textDecoration: 'NONE',
    runs: [],
    hasMissingFont: false,
  },
  visual: {
    opacity: 1,
    blendMode: 'PASS_THROUGH',
    fills: [],
    strokes: [],
    strokeWeight: 0,
    cornerRadius: 0,
    effects: [],
    clipsContent: false,
  },
  assets: {
    imagePaints: [],
    exportSettings: [],
    vector: { pathCount: 0, segmentCount: 0 },
    mask: { isMask: false },
  },
  children: [
    {
      id: '1:3',
      name: 'Child',
      type: 'RECTANGLE',
      parentId: '1:2',
      geometry: { local: bounds, absolute: bounds, rotation: 0 },
    },
  ],
  fingerprint: 'internal-fingerprint',
  truncated: false,
};

describe('紧凑节点投影', () => {
  it('省略公开默认值、空集合、重复渲染边界和内部 fingerprint', () => {
    const result = projectCompactNode(snapshot, [
      'BOUNDS',
      'LAYOUT',
      'TEXT',
      'APPEARANCE',
      'ASSET_SOURCES',
      'COMPONENT',
    ]);

    expect(result).toEqual({
      name: 'Card',
      type: 'FRAME',
      parentId: 'page:1',
      bounds: { inParent: bounds, onPage: bounds },
      layout: { overflow: { direction: 'VERTICAL', fixedChildCount: 1 } },
      text: { characters: 'Hello' },
    });
    expect(result).not.toHaveProperty('directChildren');
    expect(result).not.toHaveProperty('snapshotFingerprint');
  });

  it('只有显式请求 DIRECT_CHILDREN 时才返回直接子节点摘要', () => {
    expect(projectCompactNode(snapshot, ['DIRECT_CHILDREN'])).toEqual({
      name: 'Card',
      type: 'FRAME',
      parentId: 'page:1',
      directChildren: [
        {
          id: '1:3',
          name: 'Child',
          type: 'RECTANGLE',
          bounds: { inParent: bounds, onPage: bounds },
        },
      ],
    });
  });
});
