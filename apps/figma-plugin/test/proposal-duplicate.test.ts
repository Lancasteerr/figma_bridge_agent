import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fingerprintNodeTree: vi.fn(),
  markProposal: vi.fn(),
  resolveCurrentPageNode: vi.fn(),
  resolveProposalScope: vi.fn(),
  sourceContextFingerprint: vi.fn(),
}));

vi.mock('../src/main/mutation/coordinator.js', () => ({
  atomicMutation: async (options: {
    prepare: () => unknown | Promise<unknown>;
    mutate: (prepared: unknown) => unknown | Promise<unknown>;
  }) => await options.mutate(await options.prepare()),
}));
vi.mock('../src/main/proposal/marker.js', () => ({
  assertProposalTargets: vi.fn(),
  markProposal: mocks.markProposal,
}));
vi.mock('../src/main/proposal/scope.js', () => ({
  resolveProposalScope: mocks.resolveProposalScope,
}));
vi.mock('../src/main/proposal/source-context.js', () => ({
  sourceContextFingerprint: mocks.sourceContextFingerprint,
}));
vi.mock('../src/main/serialization/node-snapshot.js', () => ({
  fingerprintNodeTree: mocks.fingerprintNodeTree,
}));
vi.mock('../src/main/serialization/resolve.js', () => ({
  isSceneNode: (node: { type: string }) => node.type !== 'DOCUMENT' && node.type !== 'PAGE',
  resolveCurrentPageNode: mocks.resolveCurrentPageNode,
}));

import { duplicateAsProposal } from '../src/main/handlers/proposal.js';

describe('adaptive Proposal duplication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sourceContextFingerprint.mockResolvedValue('source-context');
    mocks.fingerprintNodeTree.mockResolvedValue('proposal-fingerprint');
  });

  afterEach(() => vi.unstubAllGlobals());

  it('moves a single clone to the Page, unlocks it, and returns resolved mappings', async () => {
    const fixture = installFixture();

    const result = await duplicateAsProposal({ editTargetNodeIds: ['target'] });

    expect(fixture.page.appendChild).toHaveBeenCalledWith(fixture.cloneRoot);
    expect(fixture.cloneRoot.parent).toBe(fixture.page);
    expect(fixture.cloneRoot.locked).toBe(false);
    expect(fixture.cloneTarget.locked).toBe(false);
    expect(fixture.sourceRoot.locked).toBe(true);
    expect(fixture.sourceTarget.locked).toBe(true);
    expect(mocks.markProposal).toHaveBeenCalledWith(fixture.cloneRoot, ['source-root'], ['target']);
    expect(result).toMatchObject({
      proposalRootId: 'clone-root',
      requestedTargetIds: ['target'],
      cloneRoots: [{ sourceNodeId: 'source-root', proposalNodeId: 'clone-root', nodeCount: 2 }],
      targetMap: [
        {
          sourceNodeId: 'target',
          proposalNodeId: 'clone-target',
          cloneRootSourceNodeId: 'source-root',
          resolution: 'NEAREST_CONTAINER',
        },
      ],
      warnings: [],
      fingerprint: 'proposal-fingerprint',
    });
  });

  it('removes the Proposal and reports a stable error when source context changes', async () => {
    const fixture = installFixture();
    mocks.sourceContextFingerprint
      .mockResolvedValueOnce('before-clone')
      .mockResolvedValueOnce('after-clone');

    await expect(duplicateAsProposal({ editTargetNodeIds: ['target'] })).rejects.toMatchObject({
      bridgeError: { code: 'SOURCE_CHANGED_DURING_CLONE' },
    });
    expect(fixture.cloneRoot.remove).toHaveBeenCalledOnce();
  });
});

function installFixture(): {
  page: FakePage;
  sourceRoot: FakeScene;
  sourceTarget: FakeScene;
  cloneRoot: FakeScene;
  cloneTarget: FakeScene;
} {
  const page: FakePage = {
    id: 'page',
    type: 'PAGE',
    selection: [],
    appendChild: vi.fn((node: FakeScene) => {
      node.parent = page;
    }),
  };
  const sourceTarget = scene('target', 'TEXT', true);
  const sourceRoot = scene('source-root', 'FRAME', true, [sourceTarget]);
  const sourceParent = scene('source-parent', 'FRAME', false, [sourceRoot]);
  sourceRoot.parent = sourceParent;
  sourceTarget.parent = sourceRoot;

  const cloneTarget = scene('clone-target', 'TEXT', true);
  const cloneRoot = scene('clone-root', 'FRAME', true, [cloneTarget]);
  cloneRoot.parent = sourceParent;
  cloneTarget.parent = cloneRoot;
  cloneRoot.remove = vi.fn(() => {
    cloneRoot.removed = true;
  });
  sourceRoot.clone = vi.fn(() => cloneRoot);

  mocks.resolveCurrentPageNode.mockResolvedValue(sourceTarget);
  mocks.resolveProposalScope.mockReturnValue({
    targets: [sourceTarget],
    roots: [{ node: sourceRoot, nodeCount: 2 }],
    bindings: [{ target: sourceTarget, root: sourceRoot, resolution: 'NEAREST_CONTAINER' }],
    warnings: [],
  });

  vi.stubGlobal('figma', {
    currentPage: page,
    viewport: { scrollAndZoomIntoView: vi.fn() },
  });
  return { page, sourceRoot, sourceTarget, cloneRoot, cloneTarget };
}

interface FakePage {
  id: string;
  type: 'PAGE';
  selection: FakeScene[];
  appendChild: ReturnType<typeof vi.fn>;
}

interface FakeScene {
  id: string;
  type: string;
  name: string;
  parent: FakePage | FakeScene | null;
  children: FakeScene[];
  x: number;
  y: number;
  width: number;
  height: number;
  absoluteBoundingBox: { x: number; y: number; width: number; height: number };
  visible: boolean;
  locked: boolean;
  removed: boolean;
  clone: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}

function scene(id: string, type: string, locked: boolean, children: FakeScene[] = []): FakeScene {
  return {
    id,
    type,
    name: id,
    parent: null,
    children,
    x: 10,
    y: 20,
    width: 100,
    height: 80,
    absoluteBoundingBox: { x: 10, y: 20, width: 100, height: 80 },
    visible: true,
    locked,
    removed: false,
    clone: vi.fn(),
    remove: vi.fn(),
  };
}
