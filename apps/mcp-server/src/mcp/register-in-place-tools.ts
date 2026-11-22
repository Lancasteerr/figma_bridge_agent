import {
  DeleteNodesInputSchema,
  DeleteNodesResultSchema,
  EditInPlaceInputSchema,
  EditInPlaceResultSchema,
} from '@figma-agent/protocol';
import type { McpServer } from '@modelcontextprotocol/server';

import type { BridgeTransport } from '../bridge/transport.js';
import { structuredResult, toolError } from './result.js';
import type { RegisteredToolMap } from './tool-registry.js';

/** Explicit original-artwork tools; Proposal tools retain their existing restrictions. */
export function registerInPlaceTools(
  server: McpServer,
  broker: BridgeTransport,
): RegisteredToolMap {
  return {
    figma_design_edit_in_place: server.registerTool(
      'figma_design_edit_in_place',
      {
        description:
          'Explicitly edit ORIGINAL artwork inside scopeRootId, without creating a Proposal. Only use when the user requested in-place editing. Read the complete scope fingerprint first using figma_design_read_source_fingerprint and pass it as expectedFingerprint with editMode IN_PLACE. Supports text, layout, resize, frame creation, and horizontal scrolling image carousels from staged raster assetIds (no autoplay). All operations are one undoable batch; locked nodes, instance internals, and targets outside the scope are rejected. IDs must already exist; create then inspect before editing newly created nodes.',
        inputSchema: EditInPlaceInputSchema,
        outputSchema: EditInPlaceResultSchema,
        annotations: {
          title: 'Edit Original Artwork In Place',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      async (input) => {
        try {
          return structuredResult(
            EditInPlaceResultSchema.parse(
              await broker.request('editInPlace', EditInPlaceInputSchema.parse(input), 30_000),
            ),
          );
        } catch (error) {
          return toolError(error);
        }
      },
    ),
    figma_design_delete_nodes: server.registerTool(
      'figma_design_delete_nodes',
      {
        description:
          'Permanently delete the specified original nodes and their descendants in one undoable operation, only when the user requested deletion. Requires editMode IN_PLACE, explicit scopeRootId, and its latest complete-tree expectedFingerprint. Can delete scopeRootId itself; in that case scopeRemoved is true and treeFingerprint is null. Rejects targets outside scope, overlapping IDs, locked nodes or descendants, and instance internals. Never retry automatically after timeout; inspect first.',
        inputSchema: DeleteNodesInputSchema,
        outputSchema: DeleteNodesResultSchema,
        annotations: {
          title: 'Delete Specified Figma Nodes',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      async (input) => {
        try {
          return structuredResult(
            DeleteNodesResultSchema.parse(
              await broker.request('deleteNodes', DeleteNodesInputSchema.parse(input), 30_000),
            ),
          );
        } catch (error) {
          return toolError(error);
        }
      },
    ),
  };
}
