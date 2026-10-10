import { StatusResultSchema } from '@figma-agent/protocol';
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import type { BridgeTransport } from '../bridge/transport.js';
import type { ExportStore } from '../export/export-store.js';
import { structuredResult, toolError } from './result.js';

/** 注册只读状态工具，作为 MCP 侧判断桥接是否可用的入口。 */
export function registerStatusTool(
  server: McpServer,
  broker: BridgeTransport,
  exports: ExportStore,
): void {
  server.registerTool(
    'figma_status',
    {
      description:
        'Return the authenticated local Figma plugin connection, active document, current page, current selection, and bridge capabilities.',
      inputSchema: z.object({}),
      outputSchema: StatusResultSchema,
      annotations: {
        title: 'Figma bridge status',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const pluginResult = await broker.request('status');
        const result = StatusResultSchema.parse({
          ...(pluginResult as Record<string, unknown>),
          assetExport: exports.status,
        });
        return structuredResult(result);
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
