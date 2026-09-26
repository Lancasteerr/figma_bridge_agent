import { DuplicateProposalInputSchema, ProposalResultSchema } from '@figma-agent/protocol';
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
}

