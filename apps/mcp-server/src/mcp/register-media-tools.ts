import { RenderNodeInputSchema, RenderResultSchema } from '@figma-agent/protocol';
import type { McpServer } from '@modelcontextprotocol/server';

import type { PluginConnectionBroker } from '../bridge/plugin-connection.js';
import { toolError } from './result.js';

export function registerMediaTools(server: McpServer, broker: PluginConnectionBroker): void {
  server.registerTool(
    'figma_render_node',
    {
      description:
        'Render one node from the current Figma page as a bounded PNG for visual inspection. Combine this with tree and geometry data.',
      inputSchema: RenderNodeInputSchema,
      outputSchema: RenderResultSchema,
      annotations: {
        title: 'Render Figma node',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const parsed = RenderNodeInputSchema.parse(input);
        const result = RenderResultSchema.parse(await broker.request('renderNode', parsed, 30_000));
        const metadata = {
          nodeId: result.nodeId,
          mimeType: result.mimeType,
          width: result.width,
          height: result.height,
          fingerprint: result.fingerprint,
        };
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify(metadata) },
            { type: 'image' as const, data: result.data, mimeType: result.mimeType },
          ],
          structuredContent: result,
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );
}

