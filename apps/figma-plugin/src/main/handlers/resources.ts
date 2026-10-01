import {
  DesignResourcesResultSchema,
  GetDesignResourcesInputSchema,
  type DesignResourceItem,
  type DesignResourcesResult,
} from '@figma-agent/protocol';

import { toJsonValue } from '../serialization/json.js';
import { isSceneNode } from '../serialization/resolve.js';

const MAX_SCANNED_NODES = 1_000;

/**
 * 汇总本地样式、变量和当前页组件。这里刻意不读取 key，也不调用 teamLibrary/import API。
 */
export async function getDesignResources(params: unknown): Promise<DesignResourcesResult> {
  const { cursor, limit } = GetDesignResourcesInputSchema.parse(params);
  const [paintStyles, textStyles, effectStyles, gridStyles, variables, collections] =
    await Promise.all([
      figma.getLocalPaintStylesAsync(),
      figma.getLocalTextStylesAsync(),
      figma.getLocalEffectStylesAsync(),
      figma.getLocalGridStylesAsync(),
      figma.variables.getLocalVariablesAsync(),
      figma.variables.getLocalVariableCollectionsAsync(),
    ]);

  const { nodes, truncated } = scanCurrentPage();
  const usedStyleIds = collectUsedStyleIds(nodes);
  const resources: DesignResourceItem[] = [];

  for (const style of paintStyles) {
    resources.push(styleItem(style, 'PAINT', { paints: style.paints }, usedStyleIds));
  }
  for (const style of textStyles) {
    resources.push(
      styleItem(
        style,
        'TEXT',
        {
          fontName: style.fontName,
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
          letterSpacing: style.letterSpacing,
          paragraphSpacing: style.paragraphSpacing,
          textCase: style.textCase,
          textDecoration: style.textDecoration,
        },
        usedStyleIds,
      ),
    );
  }
  for (const style of effectStyles) {
    resources.push(styleItem(style, 'EFFECT', { effects: style.effects }, usedStyleIds));
  }
  for (const style of gridStyles) {
    resources.push(styleItem(style, 'GRID', { layoutGrids: style.layoutGrids }, usedStyleIds));
  }
  for (const collection of collections) {
    resources.push({
      kind: 'VARIABLE_COLLECTION',
      id: collection.id,
      name: collection.name,
      defaultModeId: collection.defaultModeId,
      modes: collection.modes,
      variableIds: collection.variableIds,
    });
  }
  for (const variable of variables) {
    resources.push({
      kind: 'VARIABLE',
      id: variable.id,
      name: variable.name,
      collectionId: variable.variableCollectionId,
      resolvedType: variable.resolvedType,
      valuesByMode: toJsonValue(variable.valuesByMode),
      scopes: variable.scopes,
    });
  }
  for (const node of nodes) {
    if (node.type === 'COMPONENT') {
      resources.push({
        kind: 'COMPONENT',
        nodeId: node.id,
        name: node.name,
        nodeType: 'COMPONENT',
        reusableBy: ['CREATE_INSTANCE'],
        properties: toJsonValue(node.componentPropertyDefinitions),
      });
    } else if (node.type === 'COMPONENT_SET') {
      resources.push({
        kind: 'COMPONENT',
        nodeId: node.id,
        name: node.name,
        nodeType: 'COMPONENT_SET',
        reusableBy: [],
        properties: toJsonValue(node.componentPropertyDefinitions),
      });
    } else if (node.type === 'INSTANCE') {
      const main = await node.getMainComponentAsync();
      resources.push({
        kind: 'COMPONENT',
        nodeId: node.id,
        name: node.name,
        nodeType: 'INSTANCE',
        reusableBy: ['CLONE_INSTANCE'],
        ...(main && nodes.some((candidate) => candidate.id === main.id)
          ? { mainComponentId: main.id }
          : {}),
        properties: toJsonValue(node.componentProperties),
      });
    }
  }

  resources.sort((left, right) => resourceSortKey(left).localeCompare(resourceSortKey(right)));
  const page = resources.slice(cursor, cursor + limit);
  const nextCursor = cursor + page.length < resources.length ? cursor + page.length : undefined;
  return DesignResourcesResultSchema.parse({
    cursor,
    ...(nextCursor === undefined ? {} : { nextCursor }),
    total: resources.length,
    scannedNodeCount: nodes.length,
    scanTruncated: truncated,
    resources: page,
  });
}

function scanCurrentPage(): { nodes: SceneNode[]; truncated: boolean } {
  const nodes: SceneNode[] = [];
  const queue = figma.currentPage.children.filter(isSceneNode);
  while (queue.length > 0 && nodes.length < MAX_SCANNED_NODES) {
    const node = queue.shift()!;
    nodes.push(node);
    if ('children' in node) queue.push(...node.children.filter(isSceneNode));
  }
  return { nodes, truncated: queue.length > 0 };
}

function collectUsedStyleIds(nodes: SceneNode[]): Set<string> {
  const result = new Set<string>();
  for (const node of nodes) {
    for (const field of [
      'fillStyleId',
      'strokeStyleId',
      'effectStyleId',
      'gridStyleId',
      'textStyleId',
    ] as const) {
      if (!(field in node)) continue;
      const value = node[field as keyof typeof node];
      if (typeof value === 'string' && value) result.add(value);
    }
  }
  return result;
}

function styleItem(
  style: BaseStyle,
  styleType: 'PAINT' | 'TEXT' | 'EFFECT' | 'GRID',
  definition: unknown,
  usedStyleIds: Set<string>,
): DesignResourceItem {
  return {
    kind: 'STYLE',
    id: style.id,
    name: style.name,
    styleType,
    usedOnCurrentPage: usedStyleIds.has(style.id),
    definition: toJsonValue(definition),
  };
}

function resourceSortKey(resource: DesignResourceItem): string {
  if (resource.kind === 'COMPONENT')
    return `3:${resource.nodeType}:${resource.name}:${resource.nodeId}`;
  if (resource.kind === 'VARIABLE_COLLECTION') return `1:${resource.name}:${resource.id}`;
  if (resource.kind === 'VARIABLE') return `2:${resource.name}:${resource.id}`;
  return `0:${resource.styleType}:${resource.name}:${resource.id}`;
}
