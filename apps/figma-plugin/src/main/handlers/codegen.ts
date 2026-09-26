import {
  CssResultSchema,
  GetCssInputSchema,
  GetVariablesInputSchema,
  VariablesResultSchema,
} from '@figma-agent/protocol';

import { toJsonValue } from '../serialization/json.js';
import { resolveCurrentPageNode } from '../serialization/resolve.js';

export async function getCss(params: unknown): Promise<ReturnType<typeof CssResultSchema.parse>> {
  const { nodeId } = GetCssInputSchema.parse(params);
  const node = await resolveCurrentPageNode(nodeId);
  return CssResultSchema.parse({
    nodeId: node.id,
    hintOnly: true,
    properties: await node.getCSSAsync(),
  });
}

export async function getVariables(
  params: unknown,
): Promise<ReturnType<typeof VariablesResultSchema.parse>> {
  const { cursor, limit } = GetVariablesInputSchema.parse(params);
  const [variables, collections] = await Promise.all([
    figma.variables.getLocalVariablesAsync(),
    figma.variables.getLocalVariableCollectionsAsync(),
  ]);
  variables.sort((left, right) => left.id.localeCompare(right.id));
  collections.sort((left, right) => left.id.localeCompare(right.id));
  const page = variables.slice(cursor, cursor + limit).map((variable) =>
    toJsonValue({
      id: variable.id,
      key: variable.key,
      name: variable.name,
      description: variable.description,
      collectionId: variable.variableCollectionId,
      resolvedType: variable.resolvedType,
      valuesByMode: variable.valuesByMode,
      scopes: variable.scopes,
      codeSyntax: variable.codeSyntax,
      hiddenFromPublishing: variable.hiddenFromPublishing,
    }),
  );
  const nextCursor = cursor + page.length < variables.length ? cursor + page.length : undefined;
  return VariablesResultSchema.parse({
    cursor,
    ...(nextCursor !== undefined ? { nextCursor } : {}),
    total: variables.length,
    variables: page,
    collections: collections.map((collection) =>
      toJsonValue({
        id: collection.id,
        key: collection.key,
        name: collection.name,
        modes: collection.modes,
        defaultModeId: collection.defaultModeId,
        variableIds: collection.variableIds,
        hiddenFromPublishing: collection.hiddenFromPublishing,
      }),
    ),
  });
}
