import {
  BridgeFault,
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

/** 按 paint 精确提取原始图片，或在完整子树指纹一致时渲染节点。 */
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

async function exportRawImage(
  node: SceneNode,
  input: Extract<z.infer<typeof ExportAssetRpcInputSchema>, { mode: 'RAW' }>,
): Promise<ExportRpcResult> {
  const snapshot = await serializeNode(node);
  if (snapshot.fingerprint !== input.expectedNodeFingerprint) {
    throw sourceChanged(node.id, 'Node snapshot fingerprint changed.', {
      expectedNodeFingerprint: input.expectedNodeFingerprint,
      actualNodeFingerprint: snapshot.fingerprint,
    });
  }

  const paintValue =
    input.paintSlot === 'FILLS' && 'fills' in node
      ? node.fills
      : input.paintSlot === 'STROKES' && 'strokes' in node
        ? node.strokes
        : undefined;
  if (!Array.isArray(paintValue)) {
    throw sourceChanged(node.id, `${input.paintSlot} is mixed or unavailable.`);
  }
  const paint = paintValue[input.paintIndex];
  if (!paint || paint.type !== 'IMAGE' || paint.imageHash !== input.expectedImageHash) {
    throw sourceChanged(node.id, 'Image paint or image hash changed.', {
      paintSlot: input.paintSlot,
      paintIndex: input.paintIndex,
      expectedImageHash: input.expectedImageHash,
      actualImageHash: paint?.type === 'IMAGE' ? paint.imageHash : undefined,
    });
  }

  const image = figma.getImageByHash(input.expectedImageHash);
  if (!image) throw sourceChanged(node.id, 'The referenced Figma image no longer exists.');
  const [bytes, size] = await Promise.all([image.getBytesAsync(), image.getSizeAsync()]);
  assertPayloadSize(bytes.byteLength, node.id, 'Raw image');
  return ExportAssetRpcResultSchema.parse({
    nodeId: node.id,
    mode: 'RAW',
    format: 'ORIGINAL',
    mimeType: 'application/octet-stream',
    data: figma.base64Encode(bytes),
    encoding: 'base64',
    width: size.width,
    height: size.height,
    source: {
      imageHash: input.expectedImageHash,
      nodeFingerprint: snapshot.fingerprint,
    },
  });
}

async function exportRenderedNode(
  node: SceneNode,
  input: Extract<z.infer<typeof ExportAssetRpcInputSchema>, { mode: 'RENDERED' }>,
): Promise<ExportRpcResult> {
  const treeFingerprint = await fingerprintNodeTree([node]);
  if (treeFingerprint !== input.expectedTreeFingerprint) {
    throw sourceChanged(node.id, 'Node subtree fingerprint changed.', {
      expectedTreeFingerprint: input.expectedTreeFingerprint,
      actualTreeFingerprint: treeFingerprint,
    });
  }

  if (input.format === 'SVG') {
    const data = await node.exportAsync({ format: 'SVG_STRING' });
    assertPayloadSize(encodeUtf8(data).byteLength, node.id, 'Rendered SVG');
    return ExportAssetRpcResultSchema.parse({
      nodeId: node.id,
      mode: 'RENDERED',
      format: 'SVG',
      mimeType: 'image/svg+xml',
      data,
      encoding: 'utf8',
      source: { treeFingerprint },
    });
  }

  const bytes = await node.exportAsync({
    format: input.format,
    constraint: { type: 'SCALE', value: input.scale },
  });
  assertPayloadSize(bytes.byteLength, node.id, `Rendered ${input.format}`);
  return ExportAssetRpcResultSchema.parse({
    nodeId: node.id,
    mode: 'RENDERED',
    format: input.format,
    mimeType: input.format === 'PNG' ? 'image/png' : 'image/jpeg',
    data: figma.base64Encode(bytes),
    encoding: 'base64',
    width: Math.max(1, Math.round(node.width * input.scale)),
    height: Math.max(1, Math.round(node.height * input.scale)),
    source: { treeFingerprint },
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
