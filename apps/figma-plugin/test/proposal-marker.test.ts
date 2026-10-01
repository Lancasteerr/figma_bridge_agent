import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveCurrentPageNode: vi.fn(),
}));

vi.mock('../src/main/serialization/resolve.js', () => ({
  resolveCurrentPageNode: mocks.resolveCurrentPageNode,
}));
vi.mock('../src/main/serialization/node-snapshot.js', () => ({
  fingerprintNodeTree: vi.fn(),
}));

import {
  markProposal,
  readProposalMarker,
  resolveProposalRoot,
} from '../src/main/proposal/marker.js';

describe('Proposal marker compatibility', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes v3 markers with clone roots and requested edit targets', () => {
    const data = new Map<string, string>();
    const root = markerNode(data);

    markProposal(root, ['source-root'], ['requested-target']);

    expect(readProposalMarker(root)).toMatchObject({
      version: 3,
      origin: 'CLONED',
      sourceRootIds: ['source-root'],
      requestedTargetIds: ['requested-target'],
    });
  });

  it('writes generated markers without source nodes', () => {
    const data = new Map<string, string>();
    const root = markerNode(data);

    markProposal(root, []);

    expect(readProposalMarker(root)).toMatchObject({
      version: 3,
      origin: 'GENERATED',
      sourceRootIds: [],
      requestedTargetIds: [],
    });
  });

  it('continues to read v2 markers', () => {
    const data = new Map([
      [
        'figma-agent-mcp:proposal',
        JSON.stringify({
          version: 2,
          sourceRootIds: ['source-root'],
          requestedTargetIds: ['requested-target'],
          createdAt: '2026-01-01T00:00:00.000Z',
        }),
      ],
    ]);
    expect(readProposalMarker(markerNode(data))).toMatchObject({ version: 2 });
  });

  it('reports a stable error for a legacy marker instead of treating it as writable', async () => {
    const data = new Map([
      [
        'figma-agent-mcp:proposal',
        JSON.stringify({
          version: 1,
          sourceNodeIds: ['source-root'],
          createdAt: '2026-01-01T00:00:00.000Z',
        }),
      ],
    ]);
    const root = markerNode(data);
    mocks.resolveCurrentPageNode.mockResolvedValue(root);

    await expect(resolveProposalRoot(root.id)).rejects.toMatchObject({
      bridgeError: { code: 'PROPOSAL_VERSION_UNSUPPORTED' },
    });
  });
});

function markerNode(data: Map<string, string>): SceneNode {
  return {
    id: 'proposal-root',
    type: 'FRAME',
    getPluginData: (key: string) => data.get(key) ?? '',
    setPluginData: (key: string, value: string) => data.set(key, value),
  } as unknown as SceneNode;
}
