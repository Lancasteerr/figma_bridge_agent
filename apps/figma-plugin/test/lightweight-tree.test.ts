import { afterEach, describe, expect, it, vi } from 'vitest';

import { getTree } from '../src/main/handlers/read.js';

afterEach(() => vi.unstubAllGlobals());

function frame(id: string, name: string, children: SceneNode[] = []): SceneNode {
  const node = {
    id,
    name,
    type: 'FRAME',
    parent: null,
    children,
    x: 0,
    y: 0,
    width: 100,
    height: 80,
    rotation: 0,
    visible: true,
    absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 80 },
    layoutMode: 'VERTICAL',
    layoutPositioning: 'AUTO',
    fills: [],
    strokes: [],
    exportSettings: [],
  } as unknown as SceneNode;
  for (const child of children) (child as unknown as { parent: SceneNode }).parent = node;
  return node;
}

function textNode(id: string, characters: string): SceneNode {
  return {
    id,
    name: 'Title',
    type: 'TEXT',
    parent: null,
    x: 1,
    y: 2,
    width: 50,
    height: 20,
    rotation: 0,
    visible: true,
    absoluteBoundingBox: { x: 1, y: 2, width: 50, height: 20 },
    characters,
    fills: [{ type: 'IMAGE', imageHash: 'hash', scaleMode: 'FILL' }],
    strokes: [],
    exportSettings: [{ format: 'PNG' }],
  } as unknown as SceneNode;
}

function installFigma(roots: SceneNode[], getImageByHash = vi.fn()) {
  const page = {
    id: 'page:1',
    name: 'Page',
    type: 'PAGE',
    parent: null,
    children: roots,
    selection: [],
  };
  for (const root of roots) (root as unknown as { parent: unknown }).parent = page;
  const getNodeByIdAsync = vi.fn(
    async (id: string) => roots.find((root) => root.id === id) ?? null,
  );
  vi.stubGlobal('figma', {
    currentPage: page,
    getNodeByIdAsync,
    getImageByHash,
  });
  return getNodeByIdAsync;
}

describe('轻量节点树', () => {
  it('只返回导航和素材提示，不查询图片尺寸或组件详情', async () => {
    const getImageByHash = vi.fn();
    const getMainComponentAsync = vi.fn();
    const child = textNode('2:2', 'x'.repeat(100));
    const instance = {
      ...frame('2:3', 'Instance'),
      type: 'INSTANCE',
      getMainComponentAsync,
    } as unknown as SceneNode;
    const root = frame('1:1', 'Root', [child, instance]);
    installFigma([root], getImageByHash);

    const result = await getTree({ nodeId: root.id, depth: 2, maxNodes: 20, maxTextLength: 80 });

    expect(result.coverage).toEqual({ complete: true, nodeCount: 3 });
    expect(result.root.children[0]).toMatchObject({
      id: child.id,
      order: 0,
      textPreview: { value: 'x'.repeat(80), truncated: true },
      assetHints: { imagePaintCount: 1, exportSettingCount: 1 },
    });
    expect(result.root.children[0]).not.toHaveProperty('visual');
    expect(result.root.children[0]).not.toHaveProperty('fingerprint');
    expect(result.root.children[1]).toMatchObject({
      componentHint: { kind: 'INSTANCE' },
    });
    expect(getImageByHash).not.toHaveBeenCalled();
    expect(getMainComponentAsync).not.toHaveBeenCalled();
  });

  it('分别报告深度和节点数量造成的遍历截断', async () => {
    const grandchild = frame('3:3', 'Grandchild');
    const first = frame('2:1', 'First', [grandchild]);
    const second = frame('2:2', 'Second');
    const root = frame('1:1', 'Root', [first, second]);
    installFigma([root]);

    const depthLimited = await getTree({
      nodeId: root.id,
      depth: 1,
      maxNodes: 20,
      maxTextLength: 80,
    });
    expect(depthLimited.coverage).toMatchObject({
      complete: false,
      truncation: { reasons: ['DEPTH_LIMIT'], frontierNodeIds: [first.id] },
    });

    const nodeLimited = await getTree({
      nodeId: root.id,
      depth: 8,
      maxNodes: 2,
      maxTextLength: 80,
    });
    expect(nodeLimited.coverage).toMatchObject({
      complete: false,
      nodeCount: 2,
      truncation: { reasons: ['NODE_LIMIT'], frontierNodeIds: [grandchild.id, second.id] },
    });
  });

  it('从空选区浏览页面时先纳入直属图层，并限制截断 ID 的数量', async () => {
    const sectionChildren = Array.from({ length: 105 }, (_, index) =>
      frame(`2:${index}`, `Section child ${index}`),
    );
    const section = {
      ...frame('1:1', 'Section', sectionChildren),
      type: 'SECTION',
    } as SceneNode;
    const vector = { ...frame('1:3', 'Vector'), type: 'VECTOR', visible: false } as SceneNode;
    const getNodeByIdAsync = installFigma([section, frame('1:2', 'Frame'), vector]);

    const result = await getTree({ scope: 'CURRENT_PAGE', depth: 2, maxNodes: 5 });

    expect(getNodeByIdAsync).not.toHaveBeenCalled();
    expect(result.schemaVersion).toBe(3);
    expect(result.root).toMatchObject({
      id: 'page:1',
      name: 'Page',
      type: 'PAGE',
      childCount: 3,
      children: [
        { type: 'SECTION', order: 0, children: [{ id: '2:0' }] },
        { type: 'FRAME', order: 1 },
        { type: 'VECTOR', order: 2, visible: false, assetHints: { hasVector: true } },
      ],
    });
    expect(result.root).not.toHaveProperty('geometry');
    expect(result.coverage).toEqual({
      complete: false,
      nodeCount: 5,
      truncation: {
        reasons: ['NODE_LIMIT'],
        frontierNodeIds: sectionChildren.slice(1, 101).map(({ id }) => id),
        frontierNodeIdsTruncated: true,
        omittedChildCount: 104,
      },
    });

    const rootOnly = await getTree({ scope: 'CURRENT_PAGE', depth: 0 });
    expect(rootOnly.root).toMatchObject({ childCount: 3, children: [] });
    expect(rootOnly.coverage.truncation).toEqual({
      reasons: ['DEPTH_LIMIT'],
      frontierNodeIds: ['page:1'],
      omittedChildCount: 3,
    });

    installFigma([]);
    const emptyPage = await getTree({ scope: 'CURRENT_PAGE' });
    expect(emptyPage.root).toMatchObject({ childCount: 0, children: [] });
    expect(emptyPage.coverage).toEqual({ complete: true, nodeCount: 1 });
  });
});
