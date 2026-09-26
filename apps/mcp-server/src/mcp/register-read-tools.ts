import { EmptyInputSchema, SelectionResultSchema } from '@figma-agent/protocol';
import type { McpServer } from '@modelcontextprotocol/server';

import type { PluginConnectionBroker } from '../bridge/plugin-connection.js';
import { structuredResult, toolError } from './result.js';

export function registerReadTools(server: McpServer, broker: PluginConnectionBroker): void {
  server.registerTool(
    'figma_get_selection',
    {
      description: 'Return summaries for the nodes selected on the current page without traversing subtrees.',
      inputSchema: EmptyInputSchema,
      outputSchema: SelectionResultSchema,
      annotations: {
        title: 'Get Figma selection',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        return structuredResult(SelectionResultSchema.parse(await broker.request('getSelection')));
      } catch (error) {
        return toolError(error);
      }
    },
  );
}

