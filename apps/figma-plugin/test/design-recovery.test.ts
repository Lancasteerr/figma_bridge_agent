import { PROPOSAL_PLUGIN_DATA_KEY } from '@figma-agent/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GENERATED_RESOURCE_PLUGIN_DATA_KEY } from '../src/main/design-plan/resources.js';
import { recoverIncompleteDesignOperations } from '../src/main/mutation/recovery.js';

afterEach(() => vi.unstubAllGlobals());

describe('DesignPlan crash recovery', () => {
  it('removes orphan BUILDING roots and generated resources', async () => {
    const root = pluginObject(
      PROPOSAL_PLUGIN_DATA_KEY,
      proposalMarker('BUILDING', 'orphan-operation'),
    );
    const style = pluginObject(
      GENERATED_RESOURCE_PLUGIN_DATA_KEY,
      resourceMarker('BUILDING', 'orphan-operation'),
    );
    installFigma({ styles: [style] });

    await recoverIncompleteDesignOperations(pageWith(root));

    expect(root.remove).toHaveBeenCalledOnce();
    expect(style.remove).toHaveBeenCalledOnce();
  });

  it('finishes resource markers when the matching Proposal was committed', async () => {
    const root = pluginObject(
      PROPOSAL_PLUGIN_DATA_KEY,
      proposalMarker('COMMITTED', 'committed-operation'),
    );
    const style = pluginObject(
      GENERATED_RESOURCE_PLUGIN_DATA_KEY,
      resourceMarker('BUILDING', 'committed-operation'),
    );
    installFigma({ styles: [style] });

    await recoverIncompleteDesignOperations(pageWith(root));

    expect(style.remove).not.toHaveBeenCalled();
    expect(JSON.parse(style.getPluginData(GENERATED_RESOURCE_PLUGIN_DATA_KEY))).toMatchObject({
      operationId: 'committed-operation',
      state: 'COMMITTED',
    });
  });
});

function installFigma({ styles }: { styles: ReturnType<typeof pluginObject>[] }): void {
  vi.stubGlobal('figma', {
    getLocalPaintStylesAsync: vi.fn().mockResolvedValue(styles),
    getLocalTextStylesAsync: vi.fn().mockResolvedValue([]),
    getLocalEffectStylesAsync: vi.fn().mockResolvedValue([]),
    getLocalGridStylesAsync: vi.fn().mockResolvedValue([]),
    variables: {
      getLocalVariableCollectionsAsync: vi.fn().mockResolvedValue([]),
      getLocalVariablesAsync: vi.fn().mockResolvedValue([]),
    },
  });
}

function pageWith(...nodes: ReturnType<typeof pluginObject>[]) {
  return { findAllWithCriteria: vi.fn(() => nodes) } as unknown as PageNode;
}

function pluginObject(key: string, value: string) {
  const data = new Map([[key, value]]);
  return {
    getPluginData: (name: string) => data.get(name) ?? '',
    setPluginData: (name: string, next: string) => data.set(name, next),
    remove: vi.fn(),
  };
}

function proposalMarker(state: 'BUILDING' | 'COMMITTED', operationId: string): string {
  return JSON.stringify({
    version: 3,
    origin: 'GENERATED',
    sourceRootIds: [],
    requestedTargetIds: [],
    state,
    operationId,
    createdAt: '2026-10-02T00:00:00.000Z',
  });
}

function resourceMarker(state: 'BUILDING' | 'COMMITTED', operationId: string): string {
  return JSON.stringify({ version: 1, operationId, state });
}
