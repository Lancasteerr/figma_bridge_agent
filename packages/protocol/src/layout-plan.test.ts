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

// 这组 fixture 代表最小但完整的 v1 计划，后续测试只覆盖边界差异。
describe('LayoutPlan v1 schema', () => {
  it('accepts a canonical bounded plan', () => {
    expect(LayoutPlanSchema.parse(plan)).toMatchObject(plan);
  });

  it('rejects grid, wrap, and empty container children', () => {
    // v1 刻意限制为可安全映射到 Auto Layout 的能力集合。
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
