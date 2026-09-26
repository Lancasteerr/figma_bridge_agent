import {
  CreateFrameInputSchema,
  DiscardProposalInputSchema,
  DiscardProposalResultSchema,
  DuplicateProposalInputSchema,
  MutationResultSchema,
  ProposalResultSchema,
  ReparentNodesInputSchema,
  SetLayoutInputSchema,
} from '@figma-agent/protocol';
import type { McpServer } from '@modelcontextprotocol/server';

import type { PluginConnectionBroker } from '../bridge/plugin-connection.js';
import { structuredResult, toolError } from './result.js';

export function registerMutationTools(server: McpServer, broker: PluginConnectionBroker): void {
  server.registerTool(
    'figma_duplicate_as_proposal',
    {
      description:
        'Clone the supplied current-page nodes, or the current selection, into a bridge-marked Proposal beside the original. The original is never modified.',
      inputSchema: DuplicateProposalInputSchema,
      outputSchema: ProposalResultSchema,
      annotations: {
        title: 'Duplicate as Figma Proposal',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const parsed = DuplicateProposalInputSchema.parse(input);
        return structuredResult(
          ProposalResultSchema.parse(await broker.request('duplicateAsProposal', parsed, 15_000)),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'figma_create_frame',
    {
      description: 'Create one ordinary Frame inside a bridge-marked Proposal. Original design nodes are rejected.',
      inputSchema: CreateFrameInputSchema,
      outputSchema: MutationResultSchema,
      annotations: {
        title: 'Create Frame in Proposal',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const parsed = CreateFrameInputSchema.parse(input);
        return structuredResult(
          MutationResultSchema.parse(await broker.request('createFrame', parsed, 15_000)),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'figma_reparent_nodes',
    {
      description:
        'Move nodes within one bridge-marked Proposal. FLOW participates in Auto Layout; ABSOLUTE stays outside the layout flow.',
      inputSchema: ReparentNodesInputSchema,
      outputSchema: MutationResultSchema,
      annotations: {
        title: 'Reparent Proposal nodes',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const parsed = ReparentNodesInputSchema.parse(input);
        return structuredResult(
          MutationResultSchema.parse(await broker.request('reparentNodes', parsed, 15_000)),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'figma_set_layout',
    {
      description:
        'Set Auto Layout, padding, gap, alignment, sizing, or absolute positioning on a node inside one Proposal.',
      inputSchema: SetLayoutInputSchema,
      outputSchema: MutationResultSchema,
      annotations: {
        title: 'Set Proposal layout',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const parsed = SetLayoutInputSchema.parse(input);
        return structuredResult(
          MutationResultSchema.parse(await broker.request('setLayout', parsed, 15_000)),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'figma_discard_proposal',
    {
      description:
        'Delete an unchanged bridge-created Proposal. The expected fingerprint prevents deleting a Proposal edited after inspection.',
      inputSchema: DiscardProposalInputSchema,
      outputSchema: DiscardProposalResultSchema,
      annotations: {
        title: 'Discard Figma Proposal',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const parsed = DiscardProposalInputSchema.parse(input);
        return structuredResult(
          DiscardProposalResultSchema.parse(await broker.request('discardProposal', parsed, 15_000)),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
