import { afterEach, describe, expect, it, vi } from 'vitest';

import { getFingerprint, getNode, getTree } from '../src/main/handlers/read.js';
import { deleteNodes, editInPlace } from '../src/main/handlers/in-place.js';
import { resolveCurrentPageNode } from '../src/main/serialization/resolve.js';

afterEach(() => vi.unstubAllGlobals());

function runtime(empty = false) {
  const document = { id: '0:0', name: 'Document', type: 'DOCUMENT', parent: null };
  const page = {
    id: '0:1',
    name: 'Current page',
    type: 'PAGE',
    parent: document,
    children: [] as unknown[],
    selection: [],
    loadAsync: vi.fn(async () => undefined),
  };
  const otherPage = { id: '0:2', name: 'Other page', type: 'PAGE', parent: document };
  const frame = {
    id: '1:1',
    name: 'Original frame',
    type: 'FRAME',
    parent: page,
    x: 10,
    y: 20,
    width: 320,
    height: 180,
    rotation: 0,
    visible: true,
    children: [] as unknown[],
    fills: [],
    strokes: [],
    exportSettings: [],
    absoluteBoundingBox: { x: 10, y: 20, width: 320, height: 180 },
  };
  const text = {
    id: '1:2',
    name: 'Title',
    type: 'TEXT',
    parent: frame,
    x: 8,
    y: 8,
    width: 100,
    height: 20,
    rotation: 0,
    visible: true,
    characters: 'Actual page content',
    fills: [],
    strokes: [],
    exportSettings: [],
    absoluteBoundingBox: { x: 18, y: 28, width: 100, height: 20 },
  };
  const hidden = { ...frame, id: '1:3', name: 'Hidden frame', visible: false, children: [] };
  const elsewhere = { ...frame, id: '2:1', parent: otherPage };
  frame.children.push(text);
  if (!empty) page.children.push(frame, hidden);
  const nodes = new Map<string, unknown>(
    [document, page, otherPage, frame, text, hidden, elsewhere].map((node) => [node.id, node]),
  );
  const getNodeByIdAsync = vi.fn(async (id: string) => nodes.get(id) ?? null);
  const commitUndo = vi.fn();
  vi.stubGlobal('figma', { currentPage: page, getNodeByIdAsync, commitUndo });
  return { page, frame, text, hidden, elsewhere, otherPage, commitUndo };
}

describe('current PAGE navigation regression', () => {
  it('loads PAGE before accessing dynamic children', async () => {
    const { page } = runtime();
    const children = page.children;
    let loaded = false;
    page.loadAsync.mockImplementation(async () => {
      loaded = true;
    });
    Object.defineProperty(page, 'children', {
      get: () => {
        if (!loaded) throw new Error('PAGE must be loaded first');
        return children;
      },
    });
    await expect(getTree({ nodeId: page.id })).resolves.toMatchObject({ root: { type: 'PAGE' } });
    expect(page.loadAsync).toHaveBeenCalledOnce();
  });

  it.each([getNode, getTree])('rejects a page switch while loading', async (reader) => {
    const { page, otherPage } = runtime();
    page.loadAsync.mockImplementation(async () => {
      vi.stubGlobal('figma', { ...figma, currentPage: otherPage });
    });
    await expect(reader({ nodeId: page.id })).rejects.toMatchObject({
      bridgeError: { code: 'NODE_NOT_IN_CURRENT_PAGE', retryable: true },
    });
  });

  it('reads 0:1 and direct scene children without inventing page geometry', async () => {
    const { frame, hidden } = runtime();
    const result = await getNode({
      nodeId: '0:1',
      fields: ['DIRECT_CHILDREN', 'BOUNDS', 'LAYOUT', 'TEXT'],
    });
    expect(result).toMatchObject({
      name: 'Current page',
      type: 'PAGE',
      parentId: '0:0',
      directChildren: [
        { id: frame.id, bounds: { inParent: { x: 10, y: 20, width: 320, height: 180 } } },
        { id: hidden.id },
      ],
    });
    expect(result).not.toHaveProperty('bounds');
    expect(result).not.toHaveProperty('layout');
    expect(result).not.toHaveProperty('text');
  });

  it('does not list children unless DIRECT_CHILDREN is requested', async () => {
    runtime();
    expect(await getNode({ nodeId: '0:1' })).toEqual({
      name: 'Current page',
      type: 'PAGE',
      parentId: '0:0',
    });
  });

  it('browses from PAGE to artboards to actual text including hidden layers', async () => {
    const { text } = runtime();
    const result = await getTree({ nodeId: '0:1', depth: 2, maxNodes: 20 });
    expect(result.coverage).toEqual({ complete: true, nodeCount: 4 });
    expect(result.root).toMatchObject({
      id: '0:1',
      type: 'PAGE',
      childCount: 2,
      children: [
        {
          order: 0,
          children: [
            { id: text.id, textPreview: { value: 'Actual page content', truncated: false } },
          ],
        },
        { order: 1, visible: false },
      ],
    });
    expect(result.root).not.toHaveProperty('geometry');
    expect(result.root.children[0]?.geometry?.local.width).toBe(320);
  });

  it('supports empty PAGE facts and trees', async () => {
    runtime(true);
    expect(await getNode({ nodeId: '0:1', fields: ['DIRECT_CHILDREN'] })).toMatchObject({
      type: 'PAGE',
      directChildren: [],
    });
    expect(await getTree({ nodeId: '0:1' })).toMatchObject({
      coverage: { complete: true, nodeCount: 1 },
      root: { children: [], childCount: 0 },
    });
  });

  it('reports depth zero and node-limit truncation without losing the page root', async () => {
    runtime();
    const depth = await getTree({ nodeId: '0:1', depth: 0 });
    expect(depth.coverage).toMatchObject({
      complete: false,
      nodeCount: 1,
      truncation: { reasons: ['DEPTH_LIMIT'], omittedChildCount: 2, frontierNodeIds: ['0:1'] },
    });
    const limit = await getTree({ nodeId: '0:1', depth: 8, maxNodes: 1 });
    expect(limit.coverage).toMatchObject({
      complete: false,
      nodeCount: 1,
      truncation: {
        reasons: ['NODE_LIMIT'],
        omittedChildCount: 2,
        frontierNodeIds: ['1:1', '1:3'],
      },
    });
  });

  it.each(['0:2', '2:1'])('rejects cross-page read %s', async (nodeId) => {
    runtime();
    for (const reader of [getNode, getTree]) {
      await expect(reader({ nodeId })).rejects.toMatchObject({
        bridgeError: { code: 'NODE_NOT_IN_CURRENT_PAGE', nodeId },
      });
    }
  });

  it('distinguishes a missing node from an unsupported document', async () => {
    runtime();
    for (const reader of [getNode, getTree]) {
      await expect(reader({ nodeId: 'missing' })).rejects.toMatchObject({
        bridgeError: { code: 'NODE_NOT_FOUND' },
      });
      await expect(reader({ nodeId: '0:0' })).rejects.toMatchObject({
        bridgeError: { code: 'UNSUPPORTED_NODE_TYPE' },
      });
    }
  });

  it('does not expand scene-only fingerprints or permit PAGE edits or deletion', async () => {
    const { commitUndo, page } = runtime();
    await expect(resolveCurrentPageNode(page.id)).rejects.toMatchObject({
      bridgeError: { code: 'UNSUPPORTED_NODE_TYPE' },
    });
    await expect(getFingerprint({ nodeIds: [page.id] })).rejects.toMatchObject({
      bridgeError: { code: 'UNSUPPORTED_NODE_TYPE' },
    });
    const guard = {
      editMode: 'IN_PLACE',
      scopeRootId: page.id,
      expectedFingerprint: 'page-is-not-an-edit-scope',
    };
    await expect(
      editInPlace({
        ...guard,
        operations: [{ type: 'RESIZE', nodeId: page.id, width: 10, height: 10 }],
      }),
    ).rejects.toMatchObject({ bridgeError: { code: 'UNSUPPORTED_NODE_TYPE' } });
    await expect(deleteNodes({ ...guard, nodeIds: [page.id] })).rejects.toMatchObject({
      bridgeError: { code: 'UNSUPPORTED_NODE_TYPE' },
    });
    expect(commitUndo).not.toHaveBeenCalled();
    expect(page.children).toHaveLength(2);
  });
});
