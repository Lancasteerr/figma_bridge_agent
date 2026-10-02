import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fingerprintNodeTree: vi.fn() }));

vi.mock('../src/main/serialization/node-snapshot.js', () => ({
  fingerprintNodeTree: mocks.fingerprintNodeTree,
  serializeNode: vi.fn(),
}));

import { getFingerprint } from '../src/main/handlers/read.js';

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('aggregate tree fingerprint reader', () => {
  it('preserves root order and uses the write-path fingerprint algorithm', async () => {
    const page = { id: 'page-current', type: 'PAGE', parent: null };
    const first = { id: 'root-b', type: 'FRAME', x: 0, width: 100, parent: page };
    const second = { id: 'root-a', type: 'FRAME', x: 120, width: 100, parent: page };
    const nodes = new Map([
      [first.id, first],
      [second.id, second],
    ]);
    vi.stubGlobal('figma', {
      currentPage: page,
      getNodeByIdAsync: vi.fn(async (nodeId: string) => nodes.get(nodeId) ?? null),
    });
    mocks.fingerprintNodeTree.mockResolvedValue('aggregate-fingerprint');

    await expect(getFingerprint({ nodeIds: ['root-b', 'root-a'] })).resolves.toEqual({
      nodeIds: ['root-b', 'root-a'],
      fingerprint: 'aggregate-fingerprint',
    });
    expect(mocks.fingerprintNodeTree).toHaveBeenCalledWith([first, second]);
  });

  it('rejects duplicate roots before resolving nodes', async () => {
    const getNodeByIdAsync = vi.fn();
    vi.stubGlobal('figma', { getNodeByIdAsync });

    await expect(getFingerprint({ nodeIds: ['root', 'root'] })).rejects.toThrow();
    expect(getNodeByIdAsync).not.toHaveBeenCalled();
  });

  it('rejects nodes outside the current page', async () => {
    const currentPage = { id: 'page-current', type: 'PAGE', parent: null };
    const otherPage = { id: 'page-other', type: 'PAGE', parent: null };
    const node = { id: 'other-root', type: 'FRAME', x: 0, width: 100, parent: otherPage };
    vi.stubGlobal('figma', {
      currentPage,
      getNodeByIdAsync: vi.fn().mockResolvedValue(node),
    });

    await expect(getFingerprint({ nodeIds: [node.id] })).rejects.toMatchObject({
      bridgeError: { code: 'NODE_NOT_IN_CURRENT_PAGE', nodeId: node.id },
    });
    expect(mocks.fingerprintNodeTree).not.toHaveBeenCalled();
  });
});
