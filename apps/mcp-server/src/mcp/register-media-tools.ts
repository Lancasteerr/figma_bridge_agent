import { RenderNodeInputSchema, RenderResultSchema } from '@figma-agent/protocol';
import type { McpServer } from '@modelcontextprotocol/server';

import type { PluginConnectionBroker } from '../bridge/plugin-connection.js';
import type { TempAssetStore } from '../temp/asset-store.js';
import { toolError } from './result.js';

export function registerMediaTools(
  server: McpServer,
  broker: PluginConnectionBroker,
  assets: TempAssetStore,
): void {
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
        const stored = await assets.write(`${result.nodeId}.png`, Buffer.from(result.data, 'base64'));
        const metadata = {
          nodeId: result.nodeId,
          mimeType: result.mimeType,
          width: result.width,
          height: result.height,
          fingerprint: result.fingerprint,
          ...stored,
        };
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify(metadata) },
            { type: 'image' as const, data: result.data, mimeType: result.mimeType },
          ],
          structuredContent: { ...result, ...stored },
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
