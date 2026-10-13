import { BridgeFault, DesignPlanSchema } from '@figma-agent/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  applyDesignResources: vi.fn(),
  designPlanDigest: vi.fn(),
  executeDesignPlan: vi.fn(),
  fingerprintNodeTree: vi.fn(),
  preloadDesignFonts: vi.fn(),
  putValidation: vi.fn(),
  takeValidation: vi.fn(),
  validateTopology: vi.fn(),
}));

vi.mock('../src/main/mutation/coordinator.js', () => ({
  atomicMutation: async (operation: {
    prepare: () => unknown | Promise<unknown>;
    mutate: (prepared: unknown) => unknown | Promise<unknown>;
  }) => await operation.mutate(await operation.prepare()),
}));
vi.mock('../src/main/design-plan/validation-cache.js', () => ({
  designValidationCache: { put: mocks.putValidation, take: mocks.takeValidation },
}));
vi.mock('../src/main/design-plan/validator.js', () => ({
  preloadDesignFonts: mocks.preloadDesignFonts,
  validateDesignPlan: mocks.validateTopology,
}));
vi.mock('../src/main/design-plan/executor.js', () => ({
  executeDesignPlan: mocks.executeDesignPlan,
}));
vi.mock('../src/main/design-plan/resources.js', () => ({
  applyDesignResources: mocks.applyDesignResources,
  designPlanDigest: mocks.designPlanDigest,
}));
vi.mock('../src/main/serialization/node-snapshot.js', () => ({
  fingerprintNodeTree: mocks.fingerprintNodeTree,
}));

import { applyDesignPlan, validateDesignPlan } from '../src/main/handlers/design-plan.js';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.putValidation.mockReturnValue({
    validationId: 'validation-1',
    expiresAt: '2026-10-14T00:05:00.000Z',
  });
  mocks.validateTopology.mockResolvedValue({ roots: [], warnings: [] });
  mocks.designPlanDigest.mockReturnValue('a'.repeat(64));
  mocks.fingerprintNodeTree.mockResolvedValue('proposal-fingerprint');
});

describe('DesignPlan public results', () => {
  it('验证时缓存 plan 与 returnRefs，但摘要仍只基于 plan', async () => {
    const value = plan();

    await expect(validateDesignPlan({ plan: value, returnRefs: ['root'] })).resolves.toEqual({
      status: 'VALID',
      validationId: 'validation-1',
      expiresAt: '2026-10-14T00:05:00.000Z',
    });
    expect(mocks.validateTopology).toHaveBeenCalledWith(value, ['root']);
    expect(mocks.putValidation).toHaveBeenCalledWith(value, ['root']);
  });

  it('可恢复的计划错误返回 INVALID issues', async () => {
    mocks.validateTopology.mockRejectedValue(
      new BridgeFault({
        code: 'PLAN_INVALID',
        message: 'Unknown return ref: missing.',
        retryable: false,
        details: { ref: 'missing', internal: 'hidden' },
      }),
    );

    await expect(validateDesignPlan({ plan: plan(), returnRefs: ['missing'] })).resolves.toEqual({
      status: 'INVALID',
      issues: [{ code: 'PLAN_INVALID', message: 'Unknown return ref: missing.', ref: 'missing' }],
    });
  });

  it('apply 默认不返回映射', async () => {
    const value = plan();
    installApply(value, []);

    await expect(applyDesignPlan({ validationId: 'validation-1' })).resolves.toEqual({
      proposalRootId: 'proposal-root',
      proposalFingerprint: 'proposal-fingerprint',
    });
    expect(mocks.designPlanDigest).toHaveBeenCalledWith(value);
  });

  it('apply 只合并返回请求的节点和资源引用', async () => {
    const value = plan();
    installApply(value, ['root', 'brand']);

    await expect(applyDesignPlan({ validationId: 'validation-1' })).resolves.toEqual({
      proposalRootId: 'proposal-root',
      refMap: { root: 'proposal-root', brand: 'paint-style-1' },
      proposalFingerprint: 'proposal-fingerprint',
    });
  });
});

function installApply(value: ReturnType<typeof plan>, returnRefs: string[]): void {
  const resources = {
    resourceMap: { brand: 'paint-style-1', hidden: 'paint-style-2' },
    commit: vi.fn(),
    rollback: vi.fn(),
  };
  mocks.takeValidation.mockReturnValue({ plan: value, returnRefs });
  mocks.applyDesignResources.mockReturnValue(resources);
  mocks.executeDesignPlan.mockResolvedValue({
    root: { id: 'proposal-root' },
    refMap: { root: 'proposal-root', hiddenNode: 'node-2' },
  });
}

function plan() {
  return DesignPlanSchema.parse({
    version: 1,
    proposal: { name: 'Proposal' },
    root: {
      kind: 'FRAME',
      ref: 'root',
      name: 'Root',
      geometry: { width: 100, height: 100 },
      children: [],
    },
  });
}
