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

function installFigma(root: SceneNode, getImageByHash = vi.fn()): void {
  const page = { id: 'page:1', name: 'Page', type: 'PAGE', parent: null, children: [root] };
  (root as unknown as { parent: unknown }).parent = page;
  vi.stubGlobal('figma', {
    currentPage: page,
    getNodeByIdAsync: vi.fn(async (id: string) => (id === root.id ? root : null)),
    getImageByHash,
  });
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
    installFigma(root, getImageByHash);

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
    installFigma(root);

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
});
