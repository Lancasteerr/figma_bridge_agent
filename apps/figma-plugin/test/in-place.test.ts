import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fingerprintNodeTree: vi.fn() }));
vi.mock('../src/main/serialization/node-snapshot.js', () => mocks);

import { assetCache } from '../src/main/assets/asset-cache.js';
import { deleteNodes, editInPlace } from '../src/main/handlers/in-place.js';

class TestNode {
  parent: TestNode | null = null;
  children: TestNode[] = [];
  name = '';
  locked = false;
  visible = true;
  x = 0;
  y = 0;
  width = 100;
  height = 100;
  characters = 'Original';
  fontName = { family: 'Inter', style: 'Regular' };
  hasMissingFont = false;
  fontSize = 12;
  lineHeight = {};
  fills: unknown[] = [];
  layoutMode = 'NONE';
  layoutSizingHorizontal = 'FIXED';
  layoutSizingVertical = 'FIXED';
  layoutPositioning = 'AUTO';
  clipsContent = false;
  overflowDirection = 'NONE';
  data: Record<string, string> = {};
  constructor(
    readonly id: string,
    readonly type: string,
    readonly nodes: Map<string, TestNode>,
  ) {
    nodes.set(id, this);
  }
  appendChild(node: TestNode) {
    this.insertChild(this.children.length, node);
  }
  insertChild(index: number, node: TestNode) {
    node.parent?.detach(node);
    this.children.splice(index, 0, node);
    node.parent = this;
  }
  detach(node: TestNode) {
    this.children = this.children.filter((child) => child !== node);
  }
  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
  resizeWithoutConstraints(width: number, height: number) {
    this.resize(width, height);
  }
  remove() {
    this.parent?.detach(this);
    this.nodes.delete(this.id);
    for (const child of [...this.children]) child.remove();
  }
  getPluginData(key: string) {
    return this.data[key] ?? '';
  }
  setPluginData(key: string, value: string) {
    this.data[key] = value;
  }
  getRangeAllFontNames() {
    return [this.fontName];
  }
  findAllWithCriteria() {
    return [...this.nodes.values()].filter((node) => Object.keys(node.data).length > 0);
  }
}

function runtime() {
  const nodes = new Map<string, TestNode>();
  const page = new TestNode('page', 'PAGE', nodes);
  const root = new TestNode('root', 'FRAME', nodes);
  page.appendChild(root);
  const text = new TestNode('text', 'TEXT', nodes);
  root.appendChild(text);
  const sibling = new TestNode('sibling', 'FRAME', nodes);
  page.appendChild(sibling);
  let sequence = 0;
  const snapshot = () =>
    [...nodes.values()].map((node) => ({
      node,
      parent: node.parent,
      children: [...node.children],
      values: {
        characters: node.characters,
        width: node.width,
        height: node.height,
        x: node.x,
        y: node.y,
        data: { ...node.data },
      },
    }));
  const signature = () =>
    JSON.stringify(
      snapshot().map(({ node, parent, children, values }) => ({
        id: node.id,
        parent: parent?.id,
        children: children.map((child) => child.id),
        values,
      })),
    );
  const history = [{ state: snapshot(), signature: signature() }];
  const api = {
    currentPage: page,
    getNodeByIdAsync: vi.fn(async (id: string) => nodes.get(id) ?? null),
    loadFontAsync: vi.fn(async () => undefined),
    createFrame: vi.fn(() => {
      const node = new TestNode(`new-${++sequence}`, 'FRAME', nodes);
      page.appendChild(node);
      return node;
    }),
    createRectangle: vi.fn(() => {
      const node = new TestNode(`new-${++sequence}`, 'RECTANGLE', nodes);
      page.appendChild(node);
      return node;
    }),
    createImage: vi.fn(() => ({ hash: 'image-hash' })),
    commitUndo: vi.fn(() => {
      if (history.at(-1)!.signature !== signature())
        history.push({ state: snapshot(), signature: signature() });
    }),
    triggerUndo: vi.fn(() => {
      if (history.length > 1) history.pop();
      nodes.clear();
      for (const { node, parent, children, values } of history.at(-1)!.state) {
        nodes.set(node.id, node);
        node.parent = parent;
        node.children = [...children];
        Object.assign(node, values);
      }
    }),
  };
  vi.stubGlobal('figma', api);
  return { nodes, page, root, text, sibling, api, history };
}

let scene: ReturnType<typeof runtime>;
const guard = {
  scopeRootId: 'root',
  expectedFingerprint: 'current-fingerprint',
  editMode: 'IN_PLACE',
};
beforeEach(() => {
  vi.clearAllMocks();
  scene = runtime();
  mocks.fingerprintNodeTree.mockResolvedValue('current-fingerprint');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('explicit in-place edits', () => {
  it('moves ordinary canvas frames without Auto Layout ABSOLUTE positioning', async () => {
    await editInPlace({
      ...guard,
      operations: [{ type: 'LAYOUT', nodeId: 'root', absolute: { x: 30, y: 40 } }],
    });
    expect([scene.root.x, scene.root.y]).toEqual([30, 40]);
  });

  it('does not create Frames inside Component Sets', async () => {
    const variants = new TestNode('variants', 'COMPONENT_SET', scene.nodes);
    scene.root.appendChild(variants);
    await expect(
      editInPlace({
        ...guard,
        operations: [{ type: 'CREATE_FRAME', parentId: 'variants', name: 'Invalid' }],
      }),
    ).rejects.toMatchObject({ bridgeError: { code: 'UNSUPPORTED_NODE_TYPE' } });
    expect(scene.api.commitUndo).not.toHaveBeenCalled();
  });

  it('does not write when an ancestor is locked while fingerprinting', async () => {
    mocks.fingerprintNodeTree.mockImplementationOnce(async () => {
      scene.root.locked = true;
      return 'current-fingerprint';
    });
    await expect(
      editInPlace({ ...guard, operations: [{ type: 'TEXT', nodeId: 'text', characters: 'Bad' }] }),
    ).rejects.toMatchObject({ bridgeError: { code: 'NODE_LOCKED' } });
    expect(scene.api.commitUndo).not.toHaveBeenCalled();
  });

  it('preflights missing raster assets without creating a carousel', async () => {
    await expect(
      editInPlace({
        ...guard,
        operations: [
          { type: 'CAROUSEL', parentId: 'root', width: 100, height: 80, assetIds: ['absent'] },
        ],
      }),
    ).rejects.toMatchObject({ bridgeError: { code: 'ASSET_NOT_FOUND' } });
    expect(scene.api.commitUndo).not.toHaveBeenCalled();
  });
  it('updates original IDs in one undo unit without a Proposal or duplicate root', async () => {
    const result = await editInPlace({
      ...guard,
      operations: [
        { type: 'TEXT', nodeId: 'text', characters: 'Updated', fontSize: 18 },
        { type: 'RESIZE', nodeId: 'root', width: 400, height: 800 },
      ],
    });
    expect(scene.text.characters).toBe('Updated');
    expect(scene.text.fontSize).toBe(18);
    expect(scene.root.width).toBe(400);
    expect(scene.page.children.map((node) => node.id)).toEqual(['root', 'sibling']);
    expect(result.createdNodeIds).toEqual([]);
    expect(scene.history).toHaveLength(2);
    scene.api.triggerUndo();
    expect(scene.text.characters).toBe('Original');
    expect(scene.root.width).toBe(100);
  });

  it('rejects missing opt-in and stale fingerprints before opening Undo', async () => {
    await expect(
      editInPlace({
        scopeRootId: 'root',
        expectedFingerprint: 'current-fingerprint',
        operations: [{ type: 'RESIZE', nodeId: 'root', width: 1, height: 1 }],
      }),
    ).rejects.toThrow();
    await expect(
      editInPlace({
        ...guard,
        expectedFingerprint: 'old-fingerprint',
        operations: [{ type: 'TEXT', nodeId: 'text', characters: 'Bad' }],
      }),
    ).rejects.toMatchObject({ bridgeError: { code: 'EDIT_SCOPE_CHANGED' } });
    expect(scene.api.commitUndo).not.toHaveBeenCalled();
  });

  it('rejects targets outside the explicit scope', async () => {
    await expect(
      editInPlace({
        ...guard,
        operations: [{ type: 'RESIZE', nodeId: 'sibling', width: 1, height: 1 }],
      }),
    ).rejects.toMatchObject({ bridgeError: { code: 'NODE_OUTSIDE_EDIT_SCOPE' } });
    expect(scene.api.commitUndo).not.toHaveBeenCalled();
    expect(scene.sibling.width).toBe(100);
  });

  it('rejects locked ancestors even above the scope root', async () => {
    scene.root.locked = true;
    await expect(
      editInPlace({
        ...guard,
        scopeRootId: 'text',
        operations: [{ type: 'TEXT', nodeId: 'text', characters: 'Bad' }],
      }),
    ).rejects.toMatchObject({ bridgeError: { code: 'NODE_LOCKED' } });
    expect(scene.api.commitUndo).not.toHaveBeenCalled();
  });

  it('rejects instance internals and cross-page targets', async () => {
    const instance = new TestNode('instance', 'INSTANCE', scene.nodes);
    scene.root.appendChild(instance);
    instance.appendChild(scene.text);
    await expect(
      editInPlace({ ...guard, operations: [{ type: 'TEXT', nodeId: 'text', characters: 'Bad' }] }),
    ).rejects.toMatchObject({ bridgeError: { code: 'NODE_INSIDE_INSTANCE' } });
    const otherPage = new TestNode('other-page', 'PAGE', scene.nodes);
    otherPage.appendChild(scene.sibling);
    await expect(
      editInPlace({
        ...guard,
        operations: [{ type: 'RESIZE', nodeId: 'sibling', width: 1, height: 1 }],
      }),
    ).rejects.toMatchObject({ bridgeError: { code: 'NODE_NOT_IN_CURRENT_PAGE' } });
    expect(scene.api.commitUndo).not.toHaveBeenCalled();
  });

  it('detects edits while fonts are loading', async () => {
    scene.api.loadFontAsync.mockImplementationOnce(async () => {
      mocks.fingerprintNodeTree.mockResolvedValue('changed-fingerprint');
    });
    await expect(
      editInPlace({ ...guard, operations: [{ type: 'TEXT', nodeId: 'text', characters: 'Bad' }] }),
    ).rejects.toMatchObject({ bridgeError: { code: 'EDIT_SCOPE_CHANGED' } });
    expect(scene.text.characters).toBe('Original');
    expect(scene.api.commitUndo).not.toHaveBeenCalled();
  });

  it('rejects a page switch while fonts are loading', async () => {
    scene.api.loadFontAsync.mockImplementationOnce(async () => {
      scene.api.currentPage = new TestNode('other-page', 'PAGE', scene.nodes);
    });
    await expect(
      editInPlace({ ...guard, operations: [{ type: 'TEXT', nodeId: 'text', characters: 'Bad' }] }),
    ).rejects.toMatchObject({ bridgeError: { code: 'EDIT_SCOPE_CHANGED' } });
    expect(scene.api.commitUndo).not.toHaveBeenCalled();
  });

  it('preflights missing fonts and invalid layout without any writes', async () => {
    scene.text.hasMissingFont = true;
    await expect(
      editInPlace({ ...guard, operations: [{ type: 'TEXT', nodeId: 'text', characters: 'Bad' }] }),
    ).rejects.toMatchObject({ bridgeError: { code: 'MISSING_FONT' } });
    await expect(
      editInPlace({
        ...guard,
        operations: [{ type: 'LAYOUT', nodeId: 'root', sizing: { horizontal: 'FILL' } }],
      }),
    ).rejects.toMatchObject({ bridgeError: { code: 'INVALID_LAYOUT' } });
    expect(scene.api.commitUndo).not.toHaveBeenCalled();
  });

  it('rolls back earlier operations when a later write throws', async () => {
    vi.spyOn(scene.root, 'resize').mockImplementationOnce(() => {
      throw new Error('host rejected resize');
    });
    await expect(
      editInPlace({
        ...guard,
        operations: [
          { type: 'TEXT', nodeId: 'text', characters: 'Partial' },
          { type: 'RESIZE', nodeId: 'root', width: 400, height: 800 },
        ],
      }),
    ).rejects.toThrow('host rejected resize');
    expect(scene.text.characters).toBe('Original');
    expect(scene.api.triggerUndo).toHaveBeenCalledTimes(1);
    expect(scene.page.children.map((node) => node.id)).toEqual(['root', 'sibling']);
  });

  it('creates an editable image carousel inside the original frame', async () => {
    vi.spyOn(assetCache, 'get').mockReturnValue({
      assetId: 'asset',
      kind: 'RASTER',
      rasterBytes: new Uint8Array([1]),
      expiresAtMs: Date.now() + 1000,
    } as ReturnType<typeof assetCache.get>);
    const result = await editInPlace({
      ...guard,
      operations: [
        {
          type: 'CAROUSEL',
          parentId: 'root',
          width: 300,
          height: 120,
          assetIds: ['asset', 'asset'],
          gap: 8,
        },
      ],
    });
    const carousel = scene.nodes.get(result.createdNodeIds[0]!)!;
    expect(carousel.parent).toBe(scene.root);
    expect(carousel.overflowDirection).toBe('HORIZONTAL');
    expect(carousel.clipsContent).toBe(true);
    expect(carousel.children.map((node) => node.x)).toEqual([0, 308]);
    expect(carousel.children[0]!.fills).toEqual([
      { type: 'IMAGE', imageHash: 'image-hash', scaleMode: 'FILL' },
    ]);
    expect(scene.sibling.children).toEqual([]);
  });

  it('creates frames at the requested insertion index', async () => {
    const result = await editInPlace({
      ...guard,
      operations: [
        {
          type: 'CREATE_FRAME',
          parentId: 'root',
          name: 'Inserted',
          index: 0,
          width: 80,
          height: 90,
        },
      ],
    });
    expect(scene.root.children[0]!.id).toBe(result.createdNodeIds[0]);
    expect(scene.root.children[0]!.width).toBe(80);
  });
});

describe('explicit node deletion', () => {
  it('deletes only specified nodes and returns a fresh surviving-scope fingerprint', async () => {
    expect(await deleteNodes({ ...guard, nodeIds: ['text'] })).toEqual({
      deletedNodeIds: ['text'],
      scopeRemoved: false,
      treeFingerprint: 'current-fingerprint',
    });
    expect(scene.root.children).toEqual([]);
    expect(scene.page.children.map((node) => node.id)).toEqual(['root', 'sibling']);
    scene.api.triggerUndo();
    expect(scene.root.children[0]).toBe(scene.text);
  });

  it('can delete an explicitly scoped old artboard without touching siblings', async () => {
    expect(await deleteNodes({ ...guard, nodeIds: ['root'] })).toEqual({
      deletedNodeIds: ['root'],
      scopeRemoved: true,
      treeFingerprint: null,
    });
    expect(scene.page.children.map((node) => node.id)).toEqual(['sibling']);
  });

  it('rejects duplicate or overlapping targets', async () => {
    await expect(deleteNodes({ ...guard, nodeIds: ['text', 'text'] })).rejects.toThrow();
    await expect(deleteNodes({ ...guard, nodeIds: ['root', 'text'] })).rejects.toMatchObject({
      bridgeError: { code: 'NODE_OUTSIDE_EDIT_SCOPE' },
    });
    expect(scene.api.commitUndo).not.toHaveBeenCalled();
  });

  it('does not delete a frame with locked descendants', async () => {
    scene.text.locked = true;
    await expect(deleteNodes({ ...guard, nodeIds: ['root'] })).rejects.toMatchObject({
      bridgeError: { code: 'NODE_LOCKED' },
    });
    expect(scene.api.commitUndo).not.toHaveBeenCalled();
  });

  it('restores an earlier deletion if a later deletion fails', async () => {
    const second = new TestNode('second', 'TEXT', scene.nodes);
    scene.root.appendChild(second);
    vi.spyOn(second, 'remove').mockImplementationOnce(() => {
      throw new Error('host rejected delete');
    });
    await expect(deleteNodes({ ...guard, nodeIds: ['text', 'second'] })).rejects.toThrow(
      'host rejected delete',
    );
    expect(scene.root.children.map((node) => node.id)).toEqual(['text', 'second']);
  });
});
