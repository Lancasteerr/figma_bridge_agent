import {
  BridgeFault,
  CssRpcResultSchema,
  GetCssInputSchema,
  GetRawNodeInputSchema,
  RawNodeRpcResultSchema,
} from '@figma-agent/protocol';

import { resolveCurrentPageNode } from '../serialization/resolve.js';

/** 返回 Figma Inspect CSS 提示；它不是完整结构快照的替代品。 */
export async function getCss(
  params: unknown,
): Promise<ReturnType<typeof CssRpcResultSchema.parse>> {
  const { nodeId } = GetCssInputSchema.parse(params);
  const node = await resolveCurrentPageNode(nodeId);
  return CssRpcResultSchema.parse({
    nodeId: node.id,
    properties: await node.getCSSAsync(),
  });
}

/** 返回受 maxBytes 限制的 JSON_REST_V1 原始节点数据。 */
export async function getRawNode(
  params: unknown,
): Promise<ReturnType<typeof RawNodeRpcResultSchema.parse>> {
  const { nodeId, depth, fields, maxBytes } = GetRawNodeInputSchema.parse(params);
  const node = await resolveCurrentPageNode(nodeId);
  const raw = await node.exportAsync({ format: 'JSON_REST_V1' });
  const projected = projectRawNode(raw, depth, fields);
  const json = JSON.stringify(projected);
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
  return RawNodeRpcResultSchema.parse({ nodeId, node: projected, bytes });
}

/** 投影 JSON_REST_V1 的顶层字段，并把 children 深度限制为零或一层。 */
function projectRawNode(raw: unknown, depth: 0 | 1, fields?: readonly string[]): unknown {
  if (!isRecord(raw)) return raw;
  const result: Record<string, unknown> = {};
  const selectedFields = fields ?? Object.keys(raw);

  for (const identity of ['id', 'name', 'type'] as const) {
    if (Object.hasOwn(raw, identity)) result[identity] = raw[identity];
  }
  for (const field of selectedFields) {
    if (field === 'id' || field === 'name' || field === 'type' || field === 'children') continue;
    if (Object.hasOwn(raw, field)) result[field] = raw[field];
  }
  if (depth === 1 && Array.isArray(raw.children)) {
    result.children = raw.children.map((child) => projectRawNode(child, 0, fields));
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
