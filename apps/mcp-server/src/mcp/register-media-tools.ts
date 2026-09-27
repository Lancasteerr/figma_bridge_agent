import {
  ExportAssetInputSchema,
  ExportResultSchema,
  RenderNodeInputSchema,
  RenderResultSchema,
} from '@figma-agent/protocol';
import type { McpServer } from '@modelcontextprotocol/server';

import type { BridgeTransport } from '../bridge/transport.js';
import type { TempAssetStore } from '../temp/asset-store.js';
import { sanitizeName } from '../temp/asset-store.js';
import { toolError } from './result.js';

/** 注册导出和渲染工具；媒体结果统一落到临时资源目录，不写入用户项目。 */
export function registerMediaTools(
  server: McpServer,
  broker: BridgeTransport,
  assets: TempAssetStore,
): void {
  server.registerTool(
    'figma_export_asset',
    {
      description:
        'Export a node as PNG or SVG into the bridge temporary directory. Returns a sanitized local path and SHA-256, never writes into the user project.',
      inputSchema: ExportAssetInputSchema,
      outputSchema: ExportResultSchema,
      annotations: {
        title: 'Export Figma Asset',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const parsed = ExportAssetInputSchema.parse(input);
        const result = ExportResultSchema.parse(
          await broker.request('exportAsset', parsed, 60_000),
        );
        if (!result.data || !result.encoding) throw new Error('Plugin returned no export data.');
        const data =
          result.encoding === 'base64' ? Buffer.from(result.data, 'base64') : result.data;
        const stored = await assets.write(sanitizeName(result.suggestedName), data);
        const output = {
          nodeId: result.nodeId,
          format: result.format,
          mimeType: result.mimeType,
          suggestedName: sanitizeName(result.suggestedName),
          fingerprint: result.fingerprint,
          ...stored,
        };
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(output) }],
          structuredContent: output,
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

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
        const stored = await assets.write(
          `${result.nodeId}.png`,
          Buffer.from(result.data, 'base64'),
        );
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
