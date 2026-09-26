import { GetNodeInputSchema, type SelectionResultSchema } from '@figma-agent/protocol';
import type { z } from 'zod';

import { serializeNodeSummary } from '../serialization/node-summary.js';
import { serializeNode } from '../serialization/node-snapshot.js';
import { resolveCurrentPageNode } from '../serialization/resolve.js';

type SelectionResult = z.infer<typeof SelectionResultSchema>;

export function getSelection(): SelectionResult {
  return {
    page: { id: figma.currentPage.id, name: figma.currentPage.name },
    selection: figma.currentPage.selection.map(serializeNodeSummary),
  };
}

export async function getNode(params: unknown) {
  const { nodeId } = GetNodeInputSchema.parse(params);
  return await serializeNode(await resolveCurrentPageNode(nodeId));
}
