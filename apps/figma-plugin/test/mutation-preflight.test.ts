import { BridgeFault } from '@figma-agent/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertProposalTargets: vi.fn(),
  executeLayoutPlan: vi.fn(),
  fingerprintNodeTree: vi.fn(),
  takeValidation: vi.fn(),
  validateLayoutTopology: vi.fn(),
}));

vi.mock('../src/main/proposal/marker.js', () => ({
  assertProposalTargets: mocks.assertProposalTargets,
  isInside: vi.fn(),
  markProposal: vi.fn(),
}));
vi.mock('../src/main/serialization/node-snapshot.js', () => ({
  fingerprintNodeTree: mocks.fingerprintNodeTree,
}));
vi.mock('../src/main/layout-plan/validation-cache.js', () => ({
  layoutValidationCache: {
    put: vi.fn(),
    take: mocks.takeValidation,
  },
}));
vi.mock('../src/main/layout-plan/validator.js', () => ({
  validateLayoutTopology: mocks.validateLayoutTopology,
}));
vi.mock('../src/main/layout-plan/executor.js', () => ({
  executeLayoutPlan: mocks.executeLayoutPlan,
}));

import { applyLayoutPlan } from '../src/main/handlers/layout-plan.js';
import { setLayout } from '../src/main/handlers/layout.js';
import { discardProposal } from '../src/main/handlers/proposal.js';

function installFigmaSpy(): {
  commitUndo: ReturnType<typeof vi.fn>;
  triggerUndo: ReturnType<typeof vi.fn>;
} {
  const pluginData = new Map<string, string>();
  const commitUndo = vi.fn();
  const triggerUndo = vi.fn();
  vi.stubGlobal('figma', {
    currentPage: {
      selection: [],
      getPluginData: (key: string) => pluginData.get(key) ?? '',
      setPluginData: (key: string, value: string) => {
        if (value) pluginData.set(key, value);
        else pluginData.delete(key);
      },
    },
    commitUndo,
    triggerUndo,
  });
  return { commitUndo, triggerUndo };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('mutation preflight boundaries', () => {
  it('rejects invalid HUG sizing before opening an undo boundary', async () => {
    const figmaSpy = installFigmaSpy();
    const root = { id: 'proposal-root' };
    const rectangle = {
      id: 'rectangle',
      type: 'RECTANGLE',
      parent: { type: 'PAGE' },
      layoutSizingHorizontal: 'FIXED',
      layoutSizingVertical: 'FIXED',
    };
    mocks.assertProposalTargets.mockResolvedValue({ root, targets: [rectangle] });

    await expect(
      setLayout({
        proposalRootId: root.id,
        nodeId: rectangle.id,
        expectedFingerprint: 'old-fingerprint',
        sizing: { horizontal: 'HUG' },
      }),
    ).rejects.toMatchObject({
      bridgeError: { code: 'INVALID_LAYOUT' },
    });

    expect(figmaSpy.commitUndo).not.toHaveBeenCalled();
    expect(figmaSpy.triggerUndo).not.toHaveBeenCalled();
    expect(mocks.fingerprintNodeTree).not.toHaveBeenCalled();
  });

  it('rejects a stale discard before opening an undo boundary', async () => {
    const figmaSpy = installFigmaSpy();
    mocks.assertProposalTargets.mockRejectedValue(
      new BridgeFault({
        code: 'PROPOSAL_CHANGED',
        message: 'stale proposal',
        retryable: true,
        nodeId: 'proposal-root',
      }),
    );

    await expect(
      discardProposal({
        proposalRootId: 'proposal-root',
        expectedFingerprint: 'old-fingerprint',
      }),
    ).rejects.toMatchObject({
      bridgeError: { code: 'PROPOSAL_CHANGED' },
    });

    expect(figmaSpy.commitUndo).not.toHaveBeenCalled();
    expect(figmaSpy.triggerUndo).not.toHaveBeenCalled();
  });

  it('rejects a stale LayoutPlan before opening an undo boundary', async () => {
    const figmaSpy = installFigmaSpy();
    const plan = {
      source: {
        fingerprint: 'expected-fingerprint',
      },
    };
    const source = { roots: [{ id: 'source-root' }] };
    mocks.takeValidation.mockReturnValue(plan);
    mocks.validateLayoutTopology.mockResolvedValue(source);
    mocks.fingerprintNodeTree.mockResolvedValue('actual-fingerprint');

    await expect(applyLayoutPlan({ validationId: 'validation-id' })).rejects.toMatchObject({
      bridgeError: { code: 'PLAN_STALE' },
    });

    expect(figmaSpy.commitUndo).not.toHaveBeenCalled();
    expect(figmaSpy.triggerUndo).not.toHaveBeenCalled();
    expect(mocks.executeLayoutPlan).not.toHaveBeenCalled();
  });
});
