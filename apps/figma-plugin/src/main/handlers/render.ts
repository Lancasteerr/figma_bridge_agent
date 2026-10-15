import {
  BridgeFault,
  CheckAssetSourceGuardRpcInputSchema,
  CheckAssetSourceGuardRpcResultSchema,
  ExportAssetRpcInputSchema,
  ExportAssetRpcResultSchema,
  RenderNodeInputSchema,
  type RenderRpcResultSchema,
} from '@figma-agent/protocol';
import type { z } from 'zod';

import { fingerprintNodeTree, serializeNode } from '../serialization/node-snapshot.js';
import { resolveCurrentPageNode } from '../serialization/resolve.js';
import { encodeUtf8 } from '../serialization/utf8.js';

type RenderResult = z.infer<typeof RenderRpcResultSchema>;
type ExportRpcResult = z.infer<typeof ExportAssetRpcResultSchema>;
const MAX_RAW_ASSET_BYTES = 9 * 1024 * 1024;

/** 按最大尺寸压缩 PNG 渲染，并返回渲染时对应的节点指纹。 */
export async function renderNode(params: unknown): Promise<RenderResult> {
  const input = RenderNodeInputSchema.parse(params);
  const node = await resolveCurrentPageNode(input.nodeId);
  const largestDimension = Math.max(node.width, node.height, 1);
  const scale = Math.min(input.scale, input.maxDimension / largestDimension);
  const data = await node.exportAsync({
    format: 'PNG',
    constraint: { type: 'SCALE', value: scale },
  });
  assertPayloadSize(data.byteLength, node.id, 'Rendered PNG');
  const snapshot = await serializeNode(node);
  return {
    nodeId: node.id,
    mimeType: 'image/png',
    data: figma.base64Encode(data),
    width: Math.max(1, Math.round(node.width * scale)),
    height: Math.max(1, Math.round(node.height * scale)),
    fingerprint: snapshot.fingerprint,
  };
}

/** 按 paint 精确提取原始图片，或渲染节点；每项都在导出前后校验来源一致。 */
export async function exportAsset(params: unknown): Promise<ExportRpcResult> {
  const input = ExportAssetRpcInputSchema.parse(params);
  const node = await resolveCurrentPageNode(input.nodeId);
  try {
    if (input.mode === 'RAW') return await exportRawImage(node, input);
    return await exportRenderedNode(node, input);
  } catch (error) {
    if (error instanceof BridgeFault) throw error;
    throw new BridgeFault({
      code: 'EXPORT_FAILED',
      message: error instanceof Error ? error.message : 'Figma asset export failed.',
      retryable: true,
      nodeId: node.id,
    });
  }
}

/** 校验批次 guard 根和所有素材节点的归属，并返回与语义快照相同的来源指纹。 */
export async function checkAssetSourceGuard(params: unknown) {
  const input = CheckAssetSourceGuardRpcInputSchema.parse(params);
  const root = await resolveCurrentPageNode(input.rootNodeId);
  const nodes = await Promise.all(input.nodeIds.map(resolveCurrentPageNode));
  for (const node of nodes) assertDescendant(root, node);
  return CheckAssetSourceGuardRpcResultSchema.parse({
    rootNodeId: root.id,
    sourceFingerprint: await fingerprintNodeTree([root]),
  });
}

async function exportRawImage(
  node: SceneNode,
  input: Extract<z.infer<typeof ExportAssetRpcInputSchema>, { mode: 'RAW' }>,
): Promise<ExportRpcResult> {
  const before = await serializeNode(node);
  const imageHash = resolveImageHash(node, input.paintSlot, input.paintIndex);
  const image = figma.getImageByHash(imageHash);
  if (!image) throw sourceChanged(node.id, 'The referenced Figma image no longer exists.');
  const [bytes, size] = await Promise.all([image.getBytesAsync(), image.getSizeAsync()]);
  assertPayloadSize(bytes.byteLength, node.id, 'Raw image');
  const after = await serializeNode(node);
  const afterImageHash = resolveImageHash(node, input.paintSlot, input.paintIndex);
  if (before.fingerprint !== after.fingerprint || imageHash !== afterImageHash) {
    throw sourceChanged(node.id, 'The image paint changed while it was being exported.');
  }
  return ExportAssetRpcResultSchema.parse({
    nodeId: node.id,
    mode: 'RAW',
    format: 'ORIGINAL',
    mimeType: 'application/octet-stream',
    data: figma.base64Encode(bytes),
    encoding: 'base64',
    width: size.width,
    height: size.height,
  });
}

async function exportRenderedNode(
  node: SceneNode,
  input: Extract<z.infer<typeof ExportAssetRpcInputSchema>, { mode: 'RENDERED' }>,
): Promise<ExportRpcResult> {
  const before = await fingerprintNodeTree([node]);

  if (input.format === 'SVG') {
    const data = await node.exportAsync({ format: 'SVG_STRING' });
    assertPayloadSize(encodeUtf8(data).byteLength, node.id, 'Rendered SVG');
    await assertTreeUnchanged(node, before);
    return ExportAssetRpcResultSchema.parse({
      nodeId: node.id,
      mode: 'RENDERED',
      format: 'SVG',
      mimeType: 'image/svg+xml',
      data,
      encoding: 'utf8',
      width: node.width,
      height: node.height,
    });
  }

  const bytes = await node.exportAsync({
    format: input.format,
    constraint: { type: 'SCALE', value: input.scale },
  });
  assertPayloadSize(bytes.byteLength, node.id, `Rendered ${input.format}`);
  await assertTreeUnchanged(node, before);
  return ExportAssetRpcResultSchema.parse({
    nodeId: node.id,
    mode: 'RENDERED',
    format: input.format,
    mimeType: input.format === 'PNG' ? 'image/png' : 'image/jpeg',
    data: figma.base64Encode(bytes),
    encoding: 'base64',
    width: Math.max(1, Math.round(node.width * input.scale)),
    height: Math.max(1, Math.round(node.height * input.scale)),
  });
}

function resolveImageHash(
  node: SceneNode,
  paintSlot: 'FILLS' | 'STROKES',
  paintIndex: number,
): string {
  const paintValue =
    paintSlot === 'FILLS' && 'fills' in node
      ? node.fills
      : paintSlot === 'STROKES' && 'strokes' in node
        ? node.strokes
        : undefined;
  if (!Array.isArray(paintValue)) {
    throw sourceChanged(node.id, `${paintSlot} is mixed or unavailable.`);
  }
  const paint = paintValue[paintIndex];
  if (!paint || paint.type !== 'IMAGE' || !paint.imageHash) {
    throw sourceChanged(node.id, 'The selected paint is no longer an exported image.', {
      paintSlot,
      paintIndex,
    });
  }
  return paint.imageHash;
}

async function assertTreeUnchanged(node: SceneNode, before: string): Promise<void> {
  const after = await fingerprintNodeTree([node]);
  if (before !== after) {
    throw sourceChanged(node.id, 'The node subtree changed while it was being exported.');
  }
}

function assertDescendant(root: SceneNode, node: SceneNode): void {
  let current: BaseNode | null = node;
  while (current) {
    if (current.id === root.id) return;
    current = current.parent;
  }
  throw new BridgeFault({
    code: 'NODE_NOT_IN_CURRENT_PAGE',
    message: `Asset node ${node.id} is not inside source guard ${root.id}.`,
    retryable: false,
    nodeId: node.id,
  });
}

function sourceChanged(nodeId: string, message: string, details?: unknown): BridgeFault {
  return new BridgeFault({
    code: 'ASSET_SOURCE_CHANGED',
    message,
    retryable: true,
    nodeId,
    details,
  });
}

function assertPayloadSize(bytes: number, nodeId: string, label: string): void {
  if (bytes <= MAX_RAW_ASSET_BYTES) return;
  throw new BridgeFault({
    code: 'PAYLOAD_TOO_LARGE',
    message: `${label} is ${bytes} bytes; the maximum is ${MAX_RAW_ASSET_BYTES} bytes.`,
    retryable: true,
    nodeId,
  });
}
