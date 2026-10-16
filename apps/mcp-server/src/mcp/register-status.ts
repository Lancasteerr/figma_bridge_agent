import { PluginStatusResultSchema, StatusResultSchema } from '@figma-agent/protocol';
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import type { BridgeTransport } from '../bridge/transport.js';
import type { ExportStore } from '../export/export-store.js';
import { structuredResult, toolError } from './result.js';
import type { RegisteredToolMap } from './tool-registry.js';

/** 注册只读状态工具，作为 MCP 侧判断桥接是否可用的入口。 */
export function registerStatusTool(
  server: McpServer,
  broker: BridgeTransport,
  exports: ExportStore,
): RegisteredToolMap {
  const tools: RegisteredToolMap = {};
  tools.figma_status = server.registerTool(
    'figma_status',
    {
      description:
        'Return the active Figma document, page, selection, and whether this MCP session is bound to a workspace.',
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
        const pluginResult = PluginStatusResultSchema.parse(await broker.request('status'));
        const exportStatus = exports.status;
        const result = StatusResultSchema.parse({
          document: { name: pluginResult.document?.name },
          page: pluginResult.page,
          selection: pluginResult.selection.map(({ id, name, type, parentId }) => ({
            id,
            name,
            type,
            ...(parentId ? { parentId } : {}),
          })),
          workspace: exportStatus,
        });
        return structuredResult(result);
      } catch (error) {
        return toolError(error);
      }
    },
  );
  return tools;
}
