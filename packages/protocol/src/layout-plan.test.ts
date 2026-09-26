import { describe, expect, it } from 'vitest';

import { LayoutPlanSchema } from './layout-plan.js';

const plan = {
  version: 1 as const,
  source: { rootNodeIds: ['1:1'], fingerprint: '0123456789abcdef' },
  proposal: { nameSuffix: ' / Proposal', offsetX: 64, offsetY: 0 },
  root: {
    kind: 'new-frame' as const,
    name: 'ArticleCard',
    layout: {
      mode: 'VERTICAL' as const,
      gap: 12,
      padding: { top: 16, right: 16, bottom: 16, left: 16 },
      primaryAxisAlign: 'MIN' as const,
      counterAxisAlign: 'MIN' as const,
    },
    children: [{ kind: 'existing' as const, sourceNodeId: '1:1' }],
  },
  convertToComponent: false,
};

describe('LayoutPlan v1 schema', () => {
  it('accepts a canonical bounded plan', () => {
    expect(LayoutPlanSchema.parse(plan)).toMatchObject(plan);
  });

  it('rejects grid, wrap, and empty container children', () => {
    expect(() =>
      LayoutPlanSchema.parse({
        ...plan,
        root: { ...plan.root, layout: { ...plan.root.layout, mode: 'GRID' } },
      }),
    ).toThrow();
    expect(() =>
      LayoutPlanSchema.parse({
        ...plan,
        root: { ...plan.root, layout: { ...plan.root.layout, wrap: 'WRAP' } },
      }),
    ).toThrow();
    expect(() =>
      LayoutPlanSchema.parse({ ...plan, root: { ...plan.root, children: [] } }),
    ).toThrow();
  });
});
