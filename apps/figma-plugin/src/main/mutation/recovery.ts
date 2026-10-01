import { PROPOSAL_PLUGIN_DATA_KEY, ProposalMarkerV3Schema } from '@figma-agent/protocol';

import { GENERATED_RESOURCE_PLUGIN_DATA_KEY } from '../design-plan/resources.js';

/**
 * 清理由插件崩溃留下的 BUILDING 根和资源。COMMITTED 资源永不由恢复流程删除。
 */
export async function recoverIncompleteDesignOperations(page: PageNode): Promise<void> {
  const proposalRoots = page.findAllWithCriteria({
    pluginData: { keys: [PROPOSAL_PLUGIN_DATA_KEY] },
  });
  const buildingRoots: SceneNode[] = [];
  const committedOperations = new Set<string>();
  for (const node of proposalRoots) {
    const marker = parseJson(node.getPluginData(PROPOSAL_PLUGIN_DATA_KEY));
    const parsed = ProposalMarkerV3Schema.safeParse(marker);
    if (!parsed.success) continue;
    if (parsed.data.state === 'BUILDING') buildingRoots.push(node);
    else if (parsed.data.operationId) committedOperations.add(parsed.data.operationId);
  }

  // 单元测试和较旧宿主可能只提供节点 API；没有资源 API 时仍可完成根节点恢复。
  if (typeof figma.getLocalPaintStylesAsync !== 'function') {
    for (const root of buildingRoots) root.remove();
    return;
  }

  const [paint, text, effect, grid, collections, variables] = await Promise.all([
    figma.getLocalPaintStylesAsync(),
    figma.getLocalTextStylesAsync(),
    figma.getLocalEffectStylesAsync(),
    figma.getLocalGridStylesAsync(),
    figma.variables.getLocalVariableCollectionsAsync(),
    figma.variables.getLocalVariablesAsync(),
  ]);
  for (const style of [...paint, ...text, ...effect, ...grid]) {
    recoverResource(style, committedOperations);
  }
  const removedCollections = new Set<string>();
  for (const collection of collections) {
    const marker = resourceMarker(collection.getPluginData(GENERATED_RESOURCE_PLUGIN_DATA_KEY));
    if (marker?.state === 'BUILDING' && !committedOperations.has(marker.operationId)) {
      removedCollections.add(collection.id);
      collection.remove();
    } else if (marker?.state === 'BUILDING') {
      markCommitted(collection, marker.operationId, marker.planDigest);
    }
  }
  for (const variable of variables) {
    if (
      !removedCollections.has(variable.variableCollectionId) &&
      resourceMarker(variable.getPluginData(GENERATED_RESOURCE_PLUGIN_DATA_KEY))?.state ===
        'BUILDING'
    ) {
      recoverResource(variable, committedOperations);
    }
  }
  for (const root of buildingRoots) root.remove();
}

function resourceMarker(
  raw: string,
): { operationId: string; planDigest?: string; state: string } | undefined {
  const value = parseJson(raw);
  if (
    value &&
    typeof value === 'object' &&
    (value as { version?: unknown }).version === 1 &&
    typeof (value as { operationId?: unknown }).operationId === 'string' &&
    typeof (value as { state?: unknown }).state === 'string'
  ) {
    return value as { operationId: string; planDigest?: string; state: string };
  }
  return undefined;
}

function recoverResource(resource: BaseStyle | Variable, committedOperations: Set<string>): void {
  const marker = resourceMarker(resource.getPluginData(GENERATED_RESOURCE_PLUGIN_DATA_KEY));
  if (marker?.state !== 'BUILDING') return;
  if (committedOperations.has(marker.operationId)) {
    markCommitted(resource, marker.operationId, marker.planDigest);
  } else resource.remove();
}

function markCommitted(resource: PluginDataMixin, operationId: string, planDigest?: string): void {
  resource.setPluginData(
    GENERATED_RESOURCE_PLUGIN_DATA_KEY,
    JSON.stringify({
      version: 1,
      operationId,
      ...(planDigest ? { planDigest } : {}),
      state: 'COMMITTED',
    }),
  );
}

function parseJson(raw: string): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
