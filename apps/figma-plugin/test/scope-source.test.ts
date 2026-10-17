import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  serializeScopeIndex,
  serializeWorkunitSource,
} from '../src/main/serialization/scope-source.js';

const page = { id: 'page:1', name: 'Page', type: 'PAGE', parent: null } as unknown as PageNode;

function node(
  id: string,
  name: string,
  type: string,
  parent: BaseNode,
  children: SceneNode[] = [],
  overrides: Record<string, unknown> = {},
): SceneNode {
  const value = {
    id,
    name,
    type,
    parent,
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    rotation: 0,
    absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 40 },
    visible: true,
    locked: false,
    children,
    ...overrides,
  } as unknown as SceneNode;
  for (const child of children) Reflect.set(child, 'parent', value);
  return value;
}

afterEach(() => vi.unstubAllGlobals());

describe('前端来源序列化', () => {
  it('结构索引只输出稳定的扁平层级', async () => {
    const first = node('child:1', 'First', 'RECTANGLE', page);
    const second = node('child:2', 'Second', 'RECTANGLE', page);
    const root = node('root', 'Root', 'FRAME', page, [first, second]);
    const result = await serializeScopeIndex({
      root,
      depth: 2,
      maxNodes: 20,
      maxTextLength: 80,
    });
    expect(result.complete).toBe(true);
    expect(
      result.outlineJsonl
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line)),
    ).toMatchObject([
      { nodeId: 'root', parentId: null, depth: 0, order: 0, childCount: 2 },
      { nodeId: 'child:1', parentId: 'root', depth: 1, order: 0 },
      { nodeId: 'child:2', parentId: 'root', depth: 1, order: 1 },
    ]);
  });

  it('workunit 保留完整 outline，并只为选定节点生成事实', async () => {
    vi.stubGlobal('figma', { getImageByHash: vi.fn() });
    const leaf = node('leaf', 'Indicator', 'RECTANGLE', page, [], {
      absoluteRenderBounds: { x: -2, y: -2, width: 104, height: 44 },
      strokes: [],
      strokeWeight: 2,
      strokeAlign: 'OUTSIDE',
    });
    const branch = node('branch', 'Selected item', 'FRAME', page, [leaf]);
    const unrelated = node('other', 'Other item', 'FRAME', page);
    const root = node('root', 'Sidebar', 'FRAME', page, [branch, unrelated]);
    const result = await serializeWorkunitSource({
      root,
      factNodes: [leaf],
      depth: 8,
      maxNodes: 20,
      maxTextLength: 100,
    });
    expect(
      result.outlineJsonl
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line).nodeId),
    ).toEqual(['root', 'branch', 'leaf', 'other']);
    expect(
      result.factsJsonl
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line).nodeId),
    ).toEqual(['leaf']);
    expect(JSON.parse(result.factsJsonl.trim())).toMatchObject({
      bounds: { renderOnPage: { x: -2, y: -2, width: 104, height: 44 } },
      appearance: { strokeAlign: 'OUTSIDE' },
    });
  });

  it('结构和文本截断都会使实施证据不完整', async () => {
    vi.stubGlobal('figma', { getImageByHash: vi.fn() });
    const text = node('text', 'Text', 'TEXT', page, [], { characters: 'abcdef' });
    const child = node('child', 'Child', 'FRAME', page, [text]);
    const root = node('root', 'Root', 'FRAME', page, [child]);
    const depthLimited = await serializeWorkunitSource({
      root,
      factNodes: [],
      depth: 0,
      maxNodes: 20,
      maxTextLength: 3,
    });
    expect(depthLimited.complete).toBe(false);
    expect(depthLimited.truncation).toMatchObject({
      reasons: ['DEPTH_LIMIT'],
      frontierNodeIds: ['child'],
      omittedChildCount: 1,
    });
    const textLimited = await serializeWorkunitSource({
      root,
      factNodes: [],
      depth: 3,
      maxNodes: 20,
      maxTextLength: 3,
    });
    expect(textLimited.complete).toBe(false);
    expect(textLimited.truncation?.reasons).toEqual(['TEXT_LIMIT']);
  });
});
