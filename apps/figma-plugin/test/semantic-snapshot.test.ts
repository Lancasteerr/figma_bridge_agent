import { afterEach, describe, expect, it, vi } from 'vitest';

import { serializeSemanticScope } from '../src/main/serialization/semantic-snapshot.js';

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

describe('范围语义序列化', () => {
  it('OUTLINE 只输出稳定的扁平层级，不重复详细事实', async () => {
    vi.stubGlobal('figma', { getImageByHash: vi.fn() });
    const first = node('child:1', 'First', 'RECTANGLE', page);
    const second = node('child:2', 'Second', 'RECTANGLE', page);
    const root = node('root', 'Root', 'FRAME', page, [first, second]);

    const result = await serializeSemanticScope({
      root,
      profile: 'OUTLINE',
      focusNodes: [],
      depth: 2,
      maxNodes: 20,
      maxTextLength: 100,
    });

    expect(result.complete).toBe(true);
    expect(result.factsJsonl).toBe('');
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

  it('focusNodeIds 保留完整 outline，并只为焦点生成事实', async () => {
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

    const result = await serializeSemanticScope({
      root,
      profile: 'IMPLEMENTATION',
      focusNodes: [leaf],
      depth: 8,
      maxNodes: 20,
      maxTextLength: 100,
    });

    const outlineIds = result.outlineJsonl
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line).nodeId);
    const factIds = result.factsJsonl
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line).nodeId);
    expect(outlineIds).toEqual(['root', 'branch', 'leaf', 'other']);
    expect(factIds).toEqual(['leaf']);
    const fact = JSON.parse(result.factsJsonl.trim()) as Record<string, unknown>;
    expect(fact).toMatchObject({
      geometry: { absoluteRenderBounds: { x: -2, y: -2, width: 104, height: 44 } },
      visual: { strokeAlign: 'OUTSIDE' },
    });
  });

  it('区分结构截断和文本截断的完整性', async () => {
    vi.stubGlobal('figma', { getImageByHash: vi.fn() });
    const text = node('text', 'Text', 'TEXT', page, [], { characters: 'abcdef' });
    const child = node('child', 'Child', 'FRAME', page, [text]);
    const root = node('root', 'Root', 'FRAME', page, [child]);

    const depthLimited = await serializeSemanticScope({
      root,
      profile: 'IMPLEMENTATION',
      focusNodes: [],
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

    const textLimited = await serializeSemanticScope({
      root,
      profile: 'IMPLEMENTATION',
      focusNodes: [],
      depth: 3,
      maxNodes: 20,
      maxTextLength: 3,
    });
    expect(textLimited.complete).toBe(true);
    expect(textLimited.truncation?.reasons).toEqual(['TEXT_LIMIT']);
  });
});
