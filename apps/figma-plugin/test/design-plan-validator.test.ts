import { afterEach, describe, expect, it, vi } from 'vitest';

import { DesignPlanSchema } from '@figma-agent/protocol';

import { validateDesignPlan } from '../src/main/design-plan/validator.js';

afterEach(() => vi.unstubAllGlobals());

describe('DesignPlan font and text validation', () => {
  it('uses only an explicitly declared fallback', async () => {
    vi.stubGlobal('figma', {
      listAvailableFontsAsync: vi
        .fn()
        .mockResolvedValue([{ fontName: { family: 'Inter', style: 'Regular' } }]),
      getLocalPaintStylesAsync: vi.fn().mockResolvedValue([]),
      getLocalTextStylesAsync: vi.fn().mockResolvedValue([]),
      getLocalEffectStylesAsync: vi.fn().mockResolvedValue([]),
      getLocalGridStylesAsync: vi.fn().mockResolvedValue([]),
      variables: {
        getLocalVariableCollectionsAsync: vi.fn().mockResolvedValue([]),
        getLocalVariablesAsync: vi.fn().mockResolvedValue([]),
      },
    });

    const result = await validateDesignPlan(textPlan());

    expect(result.resolvedFonts.get('title:base')).toEqual({
      family: 'Inter',
      style: 'Regular',
    });
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: 'FONT_FALLBACK', ref: 'title' }),
    ]);
  });

  it('rejects text ranges beyond the character count', async () => {
    vi.stubGlobal('figma', {
      listAvailableFontsAsync: vi
        .fn()
        .mockResolvedValue([{ fontName: { family: 'Inter', style: 'Regular' } }]),
    });
    const plan = textPlan();
    plan.root.children[0]!.text.ranges = [{ start: 0, end: 99, fontSize: 20 }];

    await expect(validateDesignPlan(plan)).rejects.toMatchObject({
      bridgeError: { code: 'PLAN_INVALID' },
    });
  });

  it('creates an Instance through a current-page instance with an accessible main component', async () => {
    const page = { id: 'page-1', type: 'PAGE', parent: null };
    const component = { id: 'component-main', type: 'COMPONENT', name: 'Button' };
    const instance = {
      id: 'instance-source',
      type: 'INSTANCE',
      name: 'Imported Button',
      x: 0,
      width: 100,
      parent: page,
      getMainComponentAsync: vi.fn().mockResolvedValue(component),
    };
    vi.stubGlobal('figma', {
      currentPage: page,
      getNodeByIdAsync: vi.fn().mockResolvedValue(instance),
      listAvailableFontsAsync: vi.fn().mockResolvedValue([]),
      getLocalPaintStylesAsync: vi.fn().mockResolvedValue([]),
      getLocalTextStylesAsync: vi.fn().mockResolvedValue([]),
      getLocalEffectStylesAsync: vi.fn().mockResolvedValue([]),
      getLocalGridStylesAsync: vi.fn().mockResolvedValue([]),
      variables: {
        getLocalVariableCollectionsAsync: vi.fn().mockResolvedValue([]),
        getLocalVariablesAsync: vi.fn().mockResolvedValue([]),
      },
    });

    const result = await validateDesignPlan({
      version: 1,
      proposal: { name: 'Page', offsetX: 0, offsetY: 0 },
      resources: [],
      root: {
        kind: 'FRAME',
        ref: 'page',
        name: 'Page',
        geometry: { x: 0, y: 0, width: 1440, height: 900, rotation: 0 },
        children: [
          {
            kind: 'INSTANCE',
            ref: 'button',
            name: 'Button',
            geometry: { x: 0, y: 0, width: 100, height: 40, rotation: 0 },
            source: { mode: 'CREATE_INSTANCE', nodeId: instance.id },
            properties: {},
          },
        ],
      },
    });

    expect(result.instanceSources.get('button')).toBe(component);
  });

  it('creates an Instance directly from a current-page Component', async () => {
    const page = { id: 'page-1', type: 'PAGE', parent: null };
    const component = {
      id: 'component-source',
      type: 'COMPONENT',
      name: 'Button',
      x: 0,
      width: 100,
      parent: page,
    };
    stubDesignFigma(page, new Map([[component.id, component]]));

    const result = await validateDesignPlan(
      sourcePlan([
        {
          kind: 'INSTANCE',
          ref: 'button',
          name: 'Button',
          geometry: { width: 100, height: 40 },
          source: { mode: 'CREATE_INSTANCE', nodeId: component.id },
          properties: {},
        },
      ]),
    );

    expect(result.instanceSources.get('button')).toBe(component);
  });

  it('accepts a non-Frame current-page node as a Clone source', async () => {
    const page = { id: 'page-1', type: 'PAGE', parent: null };
    const rectangle = {
      id: 'rectangle-source',
      type: 'RECTANGLE',
      name: 'Badge',
      x: 0,
      width: 120,
      parent: page,
    };
    stubDesignFigma(page, new Map([[rectangle.id, rectangle]]));

    const result = await validateDesignPlan(
      sourcePlan(
        [
          {
            kind: 'CLONE',
            ref: 'badge',
            sourceNodeId: rectangle.id,
          },
        ],
        [rectangle.id],
      ),
    );

    expect(result.cloneSources.get('badge')).toBe(rectangle);
  });

  it('accepts CLONE_INSTANCE only for a current-page Instance', async () => {
    const page = { id: 'page-1', type: 'PAGE', parent: null };
    const instance = {
      id: 'instance-source',
      type: 'INSTANCE',
      name: 'Button',
      x: 0,
      width: 100,
      parent: page,
    };
    stubDesignFigma(page, new Map([[instance.id, instance]]));

    const result = await validateDesignPlan(
      sourcePlan([
        {
          kind: 'INSTANCE',
          ref: 'button',
          name: 'Button',
          geometry: { width: 100, height: 40 },
          source: { mode: 'CLONE_INSTANCE', nodeId: instance.id },
          properties: {},
        },
      ]),
    );

    expect(result.instanceSources.get('button')).toBe(instance);
  });

  it('rejects a Clone source inside an Instance', async () => {
    const page = { id: 'page-1', type: 'PAGE', parent: null };
    const sourceRoot = {
      id: 'source-root',
      type: 'FRAME',
      name: 'Source root',
      x: 0,
      width: 300,
      parent: page,
    };
    const instance = {
      id: 'instance-source',
      type: 'INSTANCE',
      name: 'Button',
      x: 0,
      width: 100,
      parent: sourceRoot,
    };
    const nested = {
      id: 'nested-rectangle',
      type: 'RECTANGLE',
      name: 'Nested decoration',
      x: 0,
      width: 24,
      parent: instance,
    };
    stubDesignFigma(
      page,
      new Map([
        [sourceRoot.id, sourceRoot],
        [nested.id, nested],
      ]),
    );

    await expect(
      validateDesignPlan(
        sourcePlan(
          [
            {
              kind: 'CLONE',
              ref: 'nested-decoration',
              sourceNodeId: nested.id,
            },
          ],
          [sourceRoot.id],
        ),
      ),
    ).rejects.toMatchObject({ bridgeError: { code: 'PLAN_INVALID' } });
  });
});

function sourcePlan(children: unknown[], sourceRootIds?: string[]) {
  return DesignPlanSchema.parse({
    version: 1,
    ...(sourceRootIds
      ? { source: { rootNodeIds: sourceRootIds, fingerprint: '0123456789abcdef' } }
      : {}),
    proposal: { name: 'Local proposal' },
    resources: [],
    root: {
      kind: 'FRAME',
      ref: 'proposal-root',
      name: 'Local proposal',
      geometry: { width: 360, height: 180 },
      children,
    },
  });
}

function stubDesignFigma(page: object, nodes: Map<string, object>): void {
  vi.stubGlobal('figma', {
    currentPage: page,
    getNodeByIdAsync: vi.fn(async (nodeId: string) => nodes.get(nodeId) ?? null),
    listAvailableFontsAsync: vi.fn().mockResolvedValue([]),
    getLocalPaintStylesAsync: vi.fn().mockResolvedValue([]),
    getLocalTextStylesAsync: vi.fn().mockResolvedValue([]),
    getLocalEffectStylesAsync: vi.fn().mockResolvedValue([]),
    getLocalGridStylesAsync: vi.fn().mockResolvedValue([]),
    variables: {
      getLocalVariableCollectionsAsync: vi.fn().mockResolvedValue([]),
      getLocalVariablesAsync: vi.fn().mockResolvedValue([]),
    },
  });
}

function textPlan() {
  return {
    version: 1 as const,
    proposal: { name: 'Page', offsetX: 0, offsetY: 0 },
    root: {
      kind: 'FRAME' as const,
      ref: 'page',
      name: 'Page',
      geometry: { x: 0, y: 0, width: 1440, height: 900, rotation: 0 },
      children: [
        {
          kind: 'TEXT' as const,
          ref: 'title',
          name: 'Title',
          geometry: { x: 0, y: 0, width: 600, height: 80, rotation: 0 },
          text: {
            characters: 'Hello',
            font: {
              requested: { family: 'Missing', style: 'Bold' },
              fallbacks: [{ family: 'Inter', style: 'Regular' }],
              policy: 'ALLOW_FALLBACK' as const,
            },
            fontSize: 32,
            lineHeight: { unit: 'AUTO' as const },
            letterSpacing: { value: 0, unit: 'PIXELS' as const },
            textAlignHorizontal: 'LEFT' as const,
            textAlignVertical: 'TOP' as const,
            textAutoResize: 'HEIGHT' as const,
            textCase: 'ORIGINAL' as const,
            textDecoration: 'NONE' as const,
            paragraphSpacing: 0,
            ranges: [] as Array<{ start: number; end: number; fontSize?: number }>,
          },
        },
      ],
    },
    resources: [],
  };
}
