import { DesignPlanSchema } from '@figma-agent/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DesignValidationCache } from '../src/main/design-plan/validation-cache.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-14T00:00:00.000Z'));
});

afterEach(() => vi.useRealTimers());

describe('DesignPlan validation cache', () => {
  it('保存 returnRefs，并对 validationId 执行单次消费', () => {
    const cache = new DesignValidationCache();
    const stored = cache.put(plan(), ['root']);

    expect(cache.take(stored.validationId)).toMatchObject({ returnRefs: ['root'] });
    expect(() => cache.take(stored.validationId)).toThrowError();
  });

  it('五分钟后拒绝消费验证结果', () => {
    const cache = new DesignValidationCache();
    const stored = cache.put(plan(), []);
    vi.advanceTimersByTime(5 * 60_000 + 1);

    expect(() => cache.take(stored.validationId)).toThrowError();
  });
});

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
