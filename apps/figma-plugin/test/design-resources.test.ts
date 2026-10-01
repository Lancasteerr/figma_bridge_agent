import { DesignPlanSchema } from '@figma-agent/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyDesignResources, prepareDesignResources } from '../src/main/design-plan/resources.js';
import { getDesignResources } from '../src/main/handlers/resources.js';

afterEach(() => vi.unstubAllGlobals());

describe('design resources', () => {
  it('lists only local resources and reusable nodes from the current page', async () => {
    const component = {
      id: 'component-1',
      type: 'COMPONENT',
      name: 'Button',
      componentPropertyDefinitions: { Label: { type: 'TEXT', defaultValue: 'Go' } },
      fillStyleId: 'style-1',
      x: 0,
      width: 100,
    };
    const instance = {
      id: 'instance-1',
      type: 'INSTANCE',
      name: 'Button instance',
      componentProperties: { Label: { type: 'TEXT', value: 'Buy' } },
      getMainComponentAsync: vi.fn().mockResolvedValue(component),
      x: 0,
      width: 100,
    };
    installReadFigma({ children: [component, instance] });

    const result = await getDesignResources({ cursor: 0, limit: 100 });

    expect(result.scannedNodeCount).toBe(2);
    expect(result.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'STYLE', id: 'style-1', usedOnCurrentPage: true }),
        expect.objectContaining({
          kind: 'COMPONENT',
          nodeId: 'component-1',
          reusableBy: ['CREATE_INSTANCE'],
        }),
        expect.objectContaining({
          kind: 'COMPONENT',
          nodeId: 'instance-1',
          reusableBy: ['CREATE_INSTANCE', 'CLONE_INSTANCE'],
        }),
      ]),
    );
    expect((globalThis.figma as unknown as Record<string, unknown>).teamLibrary).toBeUndefined();
  });

  it('creates namespaced resources and commits all operation markers', async () => {
    const paintStyle = resourceObject('paint-created', 'PAINT');
    const collection = collectionObject('collection-created');
    const variable = variableObject('variable-created', collection.id);
    installWriteFigma(paintStyle, collection, variable);
    const plan = resourcePlan();

    const prepared = await prepareDesignResources(plan, new Map());
    const applied = applyDesignResources(prepared, new Map(), 'operation-1', 'a'.repeat(64));
    applied.commit();

    expect(paintStyle.name).toBe('Agent/Landing/Brand');
    expect(collection.name).toBe('Agent/Landing/Tokens');
    expect(variable.name).toBe('Agent/Landing/Spacing');
    expect(applied.resourceMap).toMatchObject({
      brand: 'paint-created',
      tokens: 'collection-created',
      spacing: 'variable-created',
    });
    expect(JSON.parse(variable.getPluginData('figma-agent-mcp:generated-resource'))).toMatchObject({
      operationId: 'operation-1',
      state: 'COMMITTED',
    });
  });

  it('rejects a same-name style with different normalized content', async () => {
    const existing = resourceObject('existing', 'PAINT');
    existing.name = 'Agent/Landing/Brand';
    existing.paints = [
      {
        type: 'SOLID',
        color: { r: 1, g: 0, b: 0 },
        opacity: 1,
        visible: true,
        blendMode: 'NORMAL',
      },
    ];
    installReadFigma({ paintStyles: [existing] });

    await expect(prepareDesignResources(resourcePlan(), new Map())).rejects.toMatchObject({
      bridgeError: { code: 'RESOURCE_CONFLICT' },
    });
  });
});

function resourcePlan() {
  return DesignPlanSchema.parse({
    version: 1,
    proposal: { name: 'Landing', offsetX: 0, offsetY: 0 },
    resources: [
      {
        kind: 'PAINT_STYLE',
        ref: 'brand',
        name: 'Brand',
        paints: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }],
      },
      {
        kind: 'VARIABLE_COLLECTION',
        ref: 'tokens',
        name: 'Tokens',
        variables: [{ ref: 'spacing', name: 'Spacing', resolvedType: 'FLOAT', value: 8 }],
      },
    ],
    root: {
      kind: 'FRAME',
      ref: 'page',
      name: 'Page',
      geometry: { width: 1440, height: 900 },
      children: [],
    },
  });
}

function installReadFigma(
  options: {
    children?: unknown[];
    paintStyles?: unknown[];
  } = {},
): void {
  vi.stubGlobal('figma', {
    currentPage: { children: options.children ?? [] },
    getLocalPaintStylesAsync: vi
      .fn()
      .mockResolvedValue(
        options.paintStyles ?? [{ id: 'style-1', type: 'PAINT', name: 'Brand', paints: [] }],
      ),
    getLocalTextStylesAsync: vi.fn().mockResolvedValue([]),
    getLocalEffectStylesAsync: vi.fn().mockResolvedValue([]),
    getLocalGridStylesAsync: vi.fn().mockResolvedValue([]),
    variables: {
      getLocalVariablesAsync: vi.fn().mockResolvedValue([]),
      getLocalVariableCollectionsAsync: vi.fn().mockResolvedValue([]),
    },
  });
}

function installWriteFigma(
  paintStyle: ReturnType<typeof resourceObject>,
  collection: ReturnType<typeof collectionObject>,
  variable: ReturnType<typeof variableObject>,
): void {
  installReadFigma({ paintStyles: [] });
  Object.assign(globalThis.figma, {
    createPaintStyle: vi.fn(() => paintStyle),
    variables: {
      getLocalVariablesAsync: vi.fn().mockResolvedValue([]),
      getLocalVariableCollectionsAsync: vi.fn().mockResolvedValue([]),
      createVariableCollection: vi.fn((name: string) => {
        collection.name = name;
        return collection;
      }),
      createVariable: vi.fn((name: string) => {
        variable.name = name;
        return variable;
      }),
    },
  });
}

function resourceObject(id: string, type: string) {
  const data = new Map<string, string>();
  return {
    id,
    type,
    name: '',
    paints: [] as unknown[],
    setPluginData: (key: string, value: string) => data.set(key, value),
    getPluginData: (key: string) => data.get(key) ?? '',
    remove: vi.fn(),
  };
}

function collectionObject(id: string) {
  const data = new Map<string, string>();
  return {
    id,
    type: 'COLLECTION',
    name: '',
    defaultModeId: 'mode-1',
    modes: [{ modeId: 'mode-1', name: 'Mode 1' }],
    renameMode: vi.fn(),
    setPluginData: (key: string, value: string) => data.set(key, value),
    getPluginData: (key: string) => data.get(key) ?? '',
    remove: vi.fn(),
  };
}

function variableObject(id: string, collectionId: string) {
  return {
    ...resourceObject(id, 'VARIABLE'),
    variableCollectionId: collectionId,
    resolvedType: 'FLOAT',
    setValueForMode: vi.fn(),
  };
}
