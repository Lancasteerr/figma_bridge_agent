import {
  BridgeFault,
  CssResultSchema,
  GetCssInputSchema,
  GetVariablesInputSchema,
  GetRawNodeInputSchema,
  RawNodeResultSchema,
  VariablesResultSchema,
} from '@figma-agent/protocol';

import { toJsonValue } from '../serialization/json.js';
import { resolveCurrentPageNode } from '../serialization/resolve.js';

/** 返回 Figma Inspect CSS 提示；它不是完整结构快照的替代品。 */
export async function getCss(params: unknown): Promise<ReturnType<typeof CssResultSchema.parse>> {
  const { nodeId } = GetCssInputSchema.parse(params);
  const node = await resolveCurrentPageNode(nodeId);
  return CssResultSchema.parse({
    nodeId: node.id,
    hintOnly: true,
    properties: await node.getCSSAsync(),
  });
}

/** 按稳定 ID 排序并分页返回本地变量与集合，避免顺序和分页漂移。 */
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

/** 返回受 maxBytes 限制的 JSON_REST_V1 原始节点数据。 */
export async function getRawNode(
  params: unknown,
): Promise<ReturnType<typeof RawNodeResultSchema.parse>> {
  const { nodeId, maxBytes } = GetRawNodeInputSchema.parse(params);
  const node = await resolveCurrentPageNode(nodeId);
  const raw = await node.exportAsync({ format: 'JSON_REST_V1' });
  const json = JSON.stringify(raw);
  const bytes = utf8ByteLength(json);
  if (bytes > maxBytes) {
    throw new BridgeFault({
      code: 'PAYLOAD_TOO_LARGE',
      message: `Raw node JSON is ${bytes} bytes; the request limit is ${maxBytes} bytes.`,
      retryable: true,
      nodeId,
      details: { bytes, maxBytes },
    });
  }
  return RawNodeResultSchema.parse({ nodeId, json, bytes });
}

/** 按 UTF-8 字节数计算长度，而不是按 JavaScript UTF-16 code unit 计数。 */
function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}
