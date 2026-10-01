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

  it('accepts text, gradients, effects, constraints, and wrapped Auto Layout', () => {
    const parsed = DesignPlanSchema.parse({
      ...plan,
      root: {
        ...plan.root,
        layout: {
          mode: 'VERTICAL',
          wrap: 'WRAP',
          gap: 24,
          padding: { top: 32, right: 32, bottom: 32, left: 32 },
        },
        visual: {
          fills: [
            {
              type: 'GRADIENT_LINEAR',
              gradientTransform: [
                [1, 0, 0],
                [0, 1, 0],
              ],
              gradientStops: [
                { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
                { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } },
              ],
            },
          ],
          effects: [
            {
              type: 'DROP_SHADOW',
              color: { r: 0, g: 0, b: 0, a: 0.2 },
              offset: { x: 0, y: 8 },
              radius: 24,
            },
          ],
        },
        children: [
          {
            kind: 'TEXT',
            ref: 'title',
            name: 'Title',
            geometry: {
              width: 600,
              height: 80,
              constraints: { horizontal: 'CENTER', vertical: 'MIN' },
            },
            text: {
              characters: 'Build better products',
              font: {
                requested: { family: 'Inter', style: 'Bold' },
                fallbacks: [{ family: 'Inter', style: 'Regular' }],
                policy: 'ALLOW_FALLBACK',
              },
              fontSize: 64,
              textAutoResize: 'HEIGHT',
            },
          },
        ],
      },
    });

    expect(parsed.root).toMatchObject({
      layout: { wrap: 'WRAP' },
      children: [{ kind: 'TEXT', text: { fontSize: 64, paragraphSpacing: 0 } }],
    });
  });
});
