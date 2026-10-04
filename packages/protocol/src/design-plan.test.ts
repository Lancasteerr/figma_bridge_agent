import { readFileSync } from 'node:fs';

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

  it('accepts every complete plan documented in the bundled skill reference', () => {
    const reference = readFileSync(
      new URL(
        '../../../plugins/figma-local-agent/skills/figma-local-agent/references/design-plan-v1.md',
        import.meta.url,
      ),
      'utf8',
    );
    const examples = [...reference.matchAll(/```json\s*([\s\S]*?)```/g)].map((match) =>
      JSON.parse(match[1]!),
    );

    expect(examples).toHaveLength(2);
    for (const example of examples) expect(() => DesignPlanSchema.parse(example)).not.toThrow();
    expect(examples[0]).toMatchObject({ root: { geometry: { width: 360, height: 180 } } });
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

  it.each([
    [
      'node-level sizing',
      {
        kind: 'RECTANGLE',
        ref: 'child',
        name: 'Child',
        geometry: { width: 100, height: 40 },
        sizing: { horizontal: 'FILL' },
      },
    ],
    [
      'fontName in text',
      {
        kind: 'TEXT',
        ref: 'child',
        name: 'Child',
        geometry: { width: 100, height: 40 },
        text: { characters: 'Hello', fontName: { family: 'Inter', style: 'Regular' } },
      },
    ],
    [
      'Instance source on Clone',
      {
        kind: 'CLONE',
        ref: 'child',
        source: { mode: 'CLONE_INSTANCE', nodeId: '1:2' },
      },
    ],
    [
      'Clone source on Instance',
      {
        kind: 'INSTANCE',
        ref: 'child',
        name: 'Child',
        geometry: { width: 100, height: 40 },
        sourceNodeId: '1:2',
        properties: {},
      },
    ],
    [
      'clipsContent inside visual',
      {
        kind: 'FRAME',
        ref: 'child',
        name: 'Child',
        geometry: { width: 100, height: 40 },
        visual: { clipsContent: true },
        children: [],
      },
    ],
  ])('rejects the historical invalid shape: %s', (_label, child) => {
    expect(() =>
      DesignPlanSchema.parse({
        ...plan,
        root: { ...plan.root, children: [child] },
      }),
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

  it('accepts staged raster and SVG references', () => {
    const asset = {
      assetId: '11111111-1111-4111-8111-111111111111',
      sha256: 'a'.repeat(64),
    };
    expect(
      DesignPlanSchema.parse({
        ...plan,
        root: {
          ...plan.root,
          children: [
            {
              kind: 'IMAGE',
              ref: 'photo',
              name: 'Photo',
              geometry: { width: 640, height: 480 },
              asset,
              scaleMode: 'CROP',
            },
            {
              kind: 'SVG',
              ref: 'icon',
              name: 'Icon',
              geometry: { width: 24, height: 24 },
              asset,
            },
          ],
        },
      }),
    ).toMatchObject({ root: { children: [{ kind: 'IMAGE' }, { kind: 'SVG' }] } });
  });

  it('accepts namespaced resources, bindings, and current-page instance reuse', () => {
    const parsed = DesignPlanSchema.parse({
      ...plan,
      resources: [
        {
          kind: 'PAINT_STYLE',
          ref: 'brand',
          name: 'Brand',
          paints: [{ type: 'SOLID', color: { r: 0.1, g: 0.2, b: 0.3 } }],
        },
        {
          kind: 'VARIABLE_COLLECTION',
          ref: 'tokens',
          name: 'Tokens',
          variables: [{ ref: 'radius', name: 'Radius', resolvedType: 'FLOAT', value: 12 }],
        },
      ],
      root: {
        ...plan.root,
        styleBindings: { fill: { ref: 'brand' } },
        variableBindings: [
          { target: 'PROPERTY', field: 'cornerRadius', variable: { ref: 'radius' } },
        ],
        children: [
          {
            kind: 'INSTANCE',
            ref: 'button',
            name: 'Button',
            geometry: { width: 160, height: 48 },
            source: { mode: 'CREATE_INSTANCE', nodeId: '1:2' },
            properties: { Label: 'Buy', Enabled: true },
          },
        ],
      },
    });

    expect(parsed).toMatchObject({
      resources: [{ kind: 'PAINT_STYLE' }, { kind: 'VARIABLE_COLLECTION' }],
      root: { children: [{ kind: 'INSTANCE', properties: { Label: 'Buy' } }] },
    });
  });
});
