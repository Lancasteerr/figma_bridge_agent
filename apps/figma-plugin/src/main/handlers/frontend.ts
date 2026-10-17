import {
  BridgeFault,
  CheckWorkunitSourceRpcInputSchema,
  CheckWorkunitSourceRpcResultSchema,
  IndexScopeRpcInputSchema,
  IndexScopeRpcResultSchema,
  PrepareWorkunitRpcInputSchema,
  PrepareWorkunitRpcResultSchema,
} from '@figma-agent/protocol';

import { fingerprintNodeTree } from '../serialization/node-snapshot.js';
import { resolveCurrentPageNode } from '../serialization/resolve.js';
import { serializeScopeIndex, serializeWorkunitSource } from '../serialization/scope-source.js';
import { encodeUtf8 } from '../serialization/utf8.js';

const MAX_SOURCE_RPC_BYTES = 12 * 1024 * 1024;
const MAX_PREVIEW_DIMENSION = 2_048;

/** 为大型页面生成结构索引，不携带实施 facts。 */
export async function indexScope(params: unknown) {
  const input = IndexScopeRpcInputSchema.parse(params);
  const root = await resolveCurrentPageNode(input.rootNodeId);
  const before = await fingerprintNodeTree([root]);
  const payload = await serializeScopeIndex({ root, ...input });
  const after = await fingerprintNodeTree([root]);
  assertUnchanged(root.id, before, after);
  return IndexScopeRpcResultSchema.parse({
    ...sourceIdentity(root, after),
    request: input,
    ...payload,
  });
}

/** 为一个有界实施范围生成不可变 facts 来源。 */
export async function prepareWorkunitSource(params: unknown) {
  const input = PrepareWorkunitRpcInputSchema.parse(params);
  const root = await resolveCurrentPageNode(input.rootNodeId);
  const factNodes = await Promise.all(
    (input.factNodeIds ?? []).map((nodeId) => resolveCurrentPageNode(nodeId)),
  );
  for (const factNode of factNodes) assertDescendant(root, factNode);

  const before = await fingerprintNodeTree([root]);
  const payload = await serializeWorkunitSource({ root, factNodes, ...input });
  const preview = input.includePreview ? await renderPreview(root) : undefined;
  const after = await fingerprintNodeTree([root]);
  assertUnchanged(root.id, before, after);
  const result = PrepareWorkunitRpcResultSchema.parse({
    ...sourceIdentity(root, after),
    request: input,
    ...payload,
    ...(preview ? { preview } : {}),
  });
  const bytes = encodeUtf8(JSON.stringify(result)).byteLength;
  if (bytes > MAX_SOURCE_RPC_BYTES) {
    throw new BridgeFault({
      code: 'PAYLOAD_TOO_LARGE',
      message: `Workunit source is ${bytes} bytes; split the scope or provide factNodeIds.`,
      retryable: true,
      nodeId: root.id,
      details: { bytes, maximumBytes: MAX_SOURCE_RPC_BYTES },
    });
  }
  return result;
}

/** 使用完整树指纹检查 workunit 实施来源是否仍然新鲜。 */
export async function checkWorkunitSource(params: unknown) {
  const input = CheckWorkunitSourceRpcInputSchema.parse(params);
  const root = await resolveCurrentPageNode(input.rootNodeId);
  const currentFingerprint = await fingerprintNodeTree([root]);
  return CheckWorkunitSourceRpcResultSchema.parse({
    status: currentFingerprint === input.storedFingerprint ? 'FRESH' : 'STALE',
    rootNodeId: root.id,
    storedFingerprint: input.storedFingerprint,
    currentFingerprint,
  });
}

function sourceIdentity(root: SceneNode, sourceFingerprint: string) {
  return {
    rootNodeId: root.id,
    rootNodeName: root.name,
    document: { name: figma.root.name },
    page: { id: figma.currentPage.id, name: figma.currentPage.name },
    sourceFingerprint,
  };
}

function assertUnchanged(nodeId: string, before: string, after: string): void {
  if (before === after) return;
  throw new BridgeFault({
    code: 'WORKUNIT_SOURCE_CHANGED',
    message: 'The Figma source changed while workunit evidence was being generated.',
    retryable: true,
    nodeId,
    details: { beforeFingerprint: before, afterFingerprint: after },
  });
}

function assertDescendant(root: SceneNode, node: SceneNode): void {
  let current: BaseNode | null = node;
  while (current) {
    if (current.id === root.id) return;
    current = current.parent;
  }
  throw new BridgeFault({
    code: 'NODE_NOT_IN_CURRENT_PAGE',
    message: `Fact node ${node.id} is not inside workunit root ${root.id}.`,
    retryable: false,
    nodeId: node.id,
  });
}

async function renderPreview(node: SceneNode) {
  const largestDimension = Math.max(node.width, node.height, 1);
  const scale = Math.min(1, MAX_PREVIEW_DIMENSION / largestDimension);
  const data = await node.exportAsync({
    format: 'PNG',
    constraint: { type: 'SCALE', value: scale },
  });
  return {
    mimeType: 'image/png' as const,
    data: figma.base64Encode(data),
    pixelWidth: Math.max(1, Math.round(node.width * scale)),
    pixelHeight: Math.max(1, Math.round(node.height * scale)),
  };
}
