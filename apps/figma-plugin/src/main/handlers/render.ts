import {
  BridgeFault,
  RenderNodeInputSchema,
  type RenderResultSchema,
} from '@figma-agent/protocol';
import type { z } from 'zod';

import { serializeNode } from '../serialization/node-snapshot.js';
import { resolveCurrentPageNode } from '../serialization/resolve.js';

type RenderResult = z.infer<typeof RenderResultSchema>;
const MAX_RAW_PNG_BYTES = 9 * 1024 * 1024;

export async function renderNode(params: unknown): Promise<RenderResult> {
  const input = RenderNodeInputSchema.parse(params);
  const node = await resolveCurrentPageNode(input.nodeId);
  const largestDimension = Math.max(node.width, node.height, 1);
  const scale = Math.min(input.scale, input.maxDimension / largestDimension);
  const data = await node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: scale } });
  if (data.byteLength > MAX_RAW_PNG_BYTES) {
    throw new BridgeFault({
      code: 'PAYLOAD_TOO_LARGE',
      message: `Rendered PNG is ${data.byteLength} bytes; reduce scale or maxDimension.`,
      retryable: true,
      nodeId: node.id,
    });
  }
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

