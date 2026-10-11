import {
  BridgeFault,
  CheckSemanticScopeResultSchema,
  CheckSemanticScopeRpcInputSchema,
  ExportSemanticScopeRpcInputSchema,
  ExportSemanticScopeRpcResultSchema,
} from '@figma-agent/protocol';

import { fingerprintNodeTree } from '../serialization/node-snapshot.js';
import { resolveCurrentPageNode } from '../serialization/resolve.js';
import { serializeSemanticScope } from '../serialization/semantic-snapshot.js';
import { encodeUtf8 } from '../serialization/utf8.js';

const MAX_SEMANTIC_RPC_BYTES = 12 * 1024 * 1024;
const MAX_RENDER_DIMENSION = 2_048;

/** 生成强版本化语义正文；本地路径和会话信息只由 MCP Adapter 处理。 */
export async function exportSemanticScope(params: unknown) {
  const input = ExportSemanticScopeRpcInputSchema.parse(params);
  const root = await resolveCurrentPageNode(input.rootNodeId);
  const focusNodes = await Promise.all(
    (input.focusNodeIds ?? []).map((nodeId) => resolveCurrentPageNode(nodeId)),
  );
  for (const focus of focusNodes) assertDescendant(root, focus);

  const before = await fingerprintNodeTree([root]);
  const payload = await serializeSemanticScope({
    root,
    profile: input.profile,
    focusNodes,
    depth: input.depth,
    maxNodes: input.maxNodes,
    maxTextLength: input.maxTextLength,
  });
  const render = input.includeRender ? await renderScope(root) : undefined;
  const after = await fingerprintNodeTree([root]);
  if (before !== after) {
    throw new BridgeFault({
      code: 'SEMANTIC_SOURCE_CHANGED',
      message: 'The Figma scope changed while its semantic snapshot was being generated.',
      retryable: true,
      nodeId: root.id,
      details: { beforeFingerprint: before, afterFingerprint: after },
    });
  }

  const result = {
    rootNodeId: root.id,
    rootNodeName: root.name,
    pageId: figma.currentPage.id,
    profile: input.profile,
    sourceFingerprint: after,
    ...payload,
    ...(render ? { render } : {}),
  };
  const bytes = encodeUtf8(JSON.stringify(result)).byteLength;
  if (bytes > MAX_SEMANTIC_RPC_BYTES) {
    throw new BridgeFault({
      code: 'PAYLOAD_TOO_LARGE',
      message: `Semantic snapshot is ${bytes} bytes; the maximum is ${MAX_SEMANTIC_RPC_BYTES} bytes. Split the scope or provide focusNodeIds.`,
      retryable: true,
      nodeId: root.id,
      details: { bytes, maximumBytes: MAX_SEMANTIC_RPC_BYTES },
    });
  }
  return ExportSemanticScopeRpcResultSchema.parse(result);
}

/** 使用与 Proposal 相同的完整树指纹算法检查磁盘快照新鲜度。 */
export async function checkSemanticScope(params: unknown) {
  const input = CheckSemanticScopeRpcInputSchema.parse(params);
  const root = await resolveCurrentPageNode(input.rootNodeId);
  const currentFingerprint = await fingerprintNodeTree([root]);
  return CheckSemanticScopeResultSchema.parse({
    status: currentFingerprint === input.storedFingerprint ? 'FRESH' : 'STALE',
    rootNodeId: root.id,
    storedFingerprint: input.storedFingerprint,
    currentFingerprint,
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
    message: `Focus node ${node.id} is not inside semantic scope ${root.id}.`,
    retryable: false,
    nodeId: node.id,
  });
}

async function renderScope(node: SceneNode) {
  const largestDimension = Math.max(node.width, node.height, 1);
  const scale = Math.min(1, MAX_RENDER_DIMENSION / largestDimension);
  const data = await node.exportAsync({
    format: 'PNG',
    constraint: { type: 'SCALE', value: scale },
  });
  return {
    mimeType: 'image/png' as const,
    data: figma.base64Encode(data),
    width: Math.max(1, Math.round(node.width * scale)),
    height: Math.max(1, Math.round(node.height * scale)),
  };
}
