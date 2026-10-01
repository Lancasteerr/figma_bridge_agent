import { describe, expect, it } from 'vitest';

import { DesignPlanSchema } from './design-plan.js';

const plan = {
  version: 1 as const,
  proposal: { name: 'Landing page' },
  root: {
    kind: 'FRAME' as const,
    ref: 'page',
    name: 'Page',
    geometry: { width: 1440, height: 900 },
    children: [
      {
        kind: 'RECTANGLE' as const,
        ref: 'hero-background',
        name: 'Hero background',
        geometry: { width: 1440, height: 480 },
      },
    ],
  },
};

describe('DesignPlan v1 schema', () => {
  it('accepts a source-less generated page', () => {
    expect(DesignPlanSchema.parse(plan)).toMatchObject({
      version: 1,
      proposal: { name: 'Landing page', offsetX: 64, offsetY: 0 },
      root: { kind: 'FRAME', geometry: { width: 1440, height: 900 } },
    });
  });

  it('requires a Frame root', () => {
    expect(() =>
      DesignPlanSchema.parse({
        ...plan,
        root: { kind: 'RECTANGLE', ref: 'root', name: 'Root', geometry: {} },
      }),
    ).toThrow();
  });

  it('requires source metadata when a source is supplied', () => {
    expect(() =>
      DesignPlanSchema.parse({ ...plan, source: { rootNodeIds: [], fingerprint: '12345678' } }),
    ).toThrow();
  });
});
