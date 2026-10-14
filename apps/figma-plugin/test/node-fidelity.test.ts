import { describe, expect, it, vi } from 'vitest';

import { NodeSnapshotSchema } from '@figma-agent/protocol';

import { serializeNode } from '../src/main/serialization/node-snapshot.js';

const page = { id: 'page:1', name: 'Page', type: 'PAGE', parent: null } as unknown as PageNode;

function baseNode(overrides: Record<string, unknown> = {}): SceneNode {
  const value = {
    id: 'node:1',
    name: 'Node',
    type: 'FRAME',
    parent: page,
    x: 0,
    y: 0,
    width: 320,
    height: 180,
    rotation: 0,
    absoluteBoundingBox: { x: 10, y: 20, width: 320, height: 180 },
    absoluteRenderBounds: { x: 6, y: 16, width: 328, height: 188 },
    visible: true,
    locked: false,
    children: [],
    fills: [],
    strokes: [],
    exportSettings: [],
    ...overrides,
  } as Record<string, unknown>;
  if (value.children === undefined) delete value.children;
  return value as unknown as SceneNode;
}

describe('前端保真节点快照', () => {
  it('序列化 Auto Layout、Grid、滚动和尺寸约束', async () => {
    const snapshot = await serializeNode(
      baseNode({
        layoutMode: 'GRID',
        itemSpacing: 12,
        paddingTop: 8,
        paddingRight: 10,
        paddingBottom: 8,
        paddingLeft: 10,
        primaryAxisAlignItems: 'MIN',
        counterAxisAlignItems: 'CENTER',
        counterAxisAlignContent: 'SPACE_BETWEEN',
        counterAxisSpacing: 16,
        layoutWrap: 'WRAP',
        itemReverseZIndex: true,
        strokesIncludedInLayout: true,
        layoutSizingHorizontal: 'FILL',
        layoutSizingVertical: 'HUG',
        minWidth: 240,
        maxWidth: 720,
        minHeight: null,
        maxHeight: 480,
        layoutPositioning: 'AUTO',
        layoutAlign: 'STRETCH',
        layoutGrow: 1,
        constraints: { horizontal: 'STRETCH', vertical: 'MIN' },
        overflowDirection: 'VERTICAL_SCROLLING',
        numberOfFixedChildren: 1,
        gridRowCount: 2,
        gridColumnCount: 3,
        gridRowGap: 8,
        gridColumnGap: 12,
        gridRowSizes: [{ type: 'FIXED', value: 80 }],
        gridColumnSizes: [{ type: 'FLEX', value: 1 }],
        gridAutoTracks: 'NONE',
        gridItemsPositioning: 'ROW_AUTO_FLOW',
      }),
    );

    expect(NodeSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(snapshot.geometry?.absoluteRenderBounds).toEqual({
      x: 6,
      y: 16,
      width: 328,
      height: 188,
    });
    expect(snapshot.layout).toMatchObject({
      mode: 'GRID',
      sizing: { horizontal: 'FILL', vertical: 'HUG', minWidth: 240, maxWidth: 720 },
      item: { align: 'STRETCH', grow: 1 },
      overflow: { direction: 'VERTICAL_SCROLLING', fixedChildCount: 1 },
      grid: { rowCount: 2, columnCount: 3, rowGap: 8, columnGap: 12 },
    });
    expect(snapshot.layout?.sizing).not.toHaveProperty('minHeight');
  });

  it('只为 mixed 富文本生成最多六十四个样式区间', async () => {
    const mixed = Symbol('mixed');
    const characters = 'x'.repeat(70);
    const getStyledTextSegments = vi.fn(() =>
      Array.from({ length: 70 }, (_, index) => ({
        characters: 'x',
        start: index,
        end: index + 1,
        fontName: { family: 'Inter', style: index % 2 === 0 ? 'Regular' : 'Bold' },
        fontSize: 16,
        fontWeight: index % 2 === 0 ? 400 : 700,
        lineHeight: { unit: 'AUTO' },
        letterSpacing: { unit: 'PIXELS', value: 0 },
        textCase: 'ORIGINAL',
        textDecoration: 'NONE',
        fills: [],
        hyperlink: null,
        textStyleId: '',
        fillStyleId: '',
      })),
    );
    const snapshot = await serializeNode(
      baseNode({
        type: 'TEXT',
        children: undefined,
        characters,
        fontName: mixed,
        fontSize: mixed,
        lineHeight: mixed,
        letterSpacing: mixed,
        paragraphIndent: 0,
        paragraphSpacing: 8,
        listSpacing: 0,
        textCase: mixed,
        textDecoration: mixed,
        textAlignHorizontal: 'LEFT',
        textAlignVertical: 'CENTER',
        textAutoResize: 'HEIGHT',
        textTruncation: 'ENDING',
        maxLines: 3,
        hasMissingFont: false,
        getStyledTextSegments,
      }),
    );

    expect(NodeSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(snapshot.text).toMatchObject({
      textAlignVertical: 'CENTER',
      textAutoResize: 'HEIGHT',
      textTruncation: 'ENDING',
      maxLines: 3,
      paragraphSpacing: 8,
      runsTruncated: true,
    });
    expect(snapshot.text?.runs).toHaveLength(64);
    expect(snapshot.text?.runs?.[0]).not.toHaveProperty('characters');
    expect(getStyledTextSegments).toHaveBeenCalledWith(expect.any(Array), 0, 70);
  });

  it('序列化非默认描边和独立圆角，省略重复的默认事实', async () => {
    const snapshot = await serializeNode(
      baseNode({
        type: 'RECTANGLE',
        strokeWeight: Symbol('mixed'),
        strokeAlign: 'OUTSIDE',
        dashPattern: [4, 2],
        strokeCap: 'ROUND',
        strokeJoin: 'BEVEL',
        strokeMiterLimit: 4,
        strokeTopWeight: 1,
        strokeRightWeight: 2,
        strokeBottomWeight: 3,
        strokeLeftWeight: 4,
        cornerRadius: Symbol('mixed'),
        cornerSmoothing: 0.6,
        topLeftRadius: 4,
        topRightRadius: 8,
        bottomRightRadius: 12,
        bottomLeftRadius: 16,
      }),
    );

    expect(NodeSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(snapshot.visual).toMatchObject({
      strokeAlign: 'OUTSIDE',
      dashPattern: [4, 2],
      strokeCap: 'ROUND',
      strokeJoin: 'BEVEL',
      individualStrokeWeights: { top: 1, right: 2, bottom: 3, left: 4 },
      cornerSmoothing: 0.6,
      cornerRadii: { topLeft: 4, topRight: 8, bottomRight: 12, bottomLeft: 16 },
    });
    expect(snapshot.visual).not.toHaveProperty('strokeMiterLimit');
  });
});
