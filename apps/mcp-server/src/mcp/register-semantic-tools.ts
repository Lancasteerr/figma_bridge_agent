import {
  CheckSemanticScopeInputSchema,
  CheckSemanticScopeResultSchema,
  CheckSemanticScopeRpcResultSchema,
  ExportSemanticScopeInputSchema,
  ExportSemanticScopeResultSchema,
  ExportSemanticScopeRpcInputSchema,
  ExportSemanticScopeRpcResultSchema,
  BridgeFault,
} from '@figma-agent/protocol';
import type { McpServer } from '@modelcontextprotocol/server';

import type { BridgeTransport } from '../bridge/transport.js';
import type { SemanticSnapshotStore } from '../semantic/semantic-snapshot-store.js';
import { structuredResult, toolError } from './result.js';

/** 注册只返回磁盘引用的语义快照工具，正文仅在插件与本机 Adapter 之间传递。 */
export function registerSemanticTools(
  server: McpServer,
  broker: BridgeTransport,
  snapshots: SemanticSnapshotStore,
): void {
  server.registerTool(
    'figma_export_semantic_scope',
    {
      description:
        'Export a bounded Figma scope as workspace-persisted outline/facts JSONL. Bind the workspace first; the public result contains only the relative manifest path and source state.',
      inputSchema: ExportSemanticScopeInputSchema,
      outputSchema: ExportSemanticScopeResultSchema,
      annotations: {
        title: 'Export Figma Semantic Scope',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const parsed = ExportSemanticScopeInputSchema.parse(input);
        assertSession(parsed.expectedSessionId, snapshots);
        // 持久快照在请求插件前检查绑定，避免生成无法落盘的大型正文。
        snapshots.workspace.beginWrite();
        const rpcInput = ExportSemanticScopeRpcInputSchema.parse({
          rootNodeId: parsed.rootNodeId,
          profile: parsed.profile,
          focusNodeIds: parsed.focusNodeIds,
          includeRender: parsed.includeRender,
          depth: parsed.depth,
          maxNodes: parsed.maxNodes,
          maxTextLength: parsed.maxTextLength,
        });
        const result = ExportSemanticScopeRpcResultSchema.parse(
          await broker.request('exportSemanticScope', rpcInput, 120_000),
        );
        return structuredResult(
          ExportSemanticScopeResultSchema.parse(await snapshots.write(result)),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'figma_check_semantic_scope',
    {
      description:
        'Compare a stored semantic scope fingerprint with the current complete Figma subtree without re-exporting semantic bodies.',
      inputSchema: CheckSemanticScopeInputSchema,
      outputSchema: CheckSemanticScopeResultSchema,
      annotations: {
        title: 'Check Figma Semantic Scope',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const parsed = CheckSemanticScopeInputSchema.parse(input);
        assertSession(parsed.expectedSessionId, snapshots);
        const rpc = CheckSemanticScopeRpcResultSchema.parse(
          await broker.request(
            'checkSemanticScope',
            {
              rootNodeId: parsed.rootNodeId,
              storedFingerprint: parsed.storedFingerprint,
            },
            30_000,
          ),
        );
        return structuredResult(CheckSemanticScopeResultSchema.parse({ status: rpc.status }));
      } catch (error) {
        return toolError(error);
      }
    },
  );
}

function assertSession(expectedSessionId: string, snapshots: SemanticSnapshotStore): void {
  if (expectedSessionId === snapshots.workspace.sessionId) return;
  throw new BridgeFault({
    code: 'EXPORT_SESSION_MISMATCH',
    message: 'Semantic snapshot session changed; call figma_status and use the current session.',
    retryable: true,
    details: { expectedSessionId, actualSessionId: snapshots.workspace.sessionId },
  });
}
