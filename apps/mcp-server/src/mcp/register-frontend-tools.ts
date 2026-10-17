import {
  BridgeFault,
  CheckWorkunitSourceResultSchema,
  CheckWorkunitSourceRpcInputSchema,
  CheckWorkunitSourceRpcResultSchema,
  IndexScopeInputSchema,
  IndexScopeResultSchema,
  IndexScopeRpcInputSchema,
  IndexScopeRpcResultSchema,
  PrepareWorkunitInputSchema,
  PrepareWorkunitResultSchema,
  PrepareWorkunitRpcInputSchema,
  PrepareWorkunitRpcResultSchema,
  WorkunitIdInputSchema,
} from '@figma-agent/protocol';
import type { McpServer } from '@modelcontextprotocol/server';

import type { BridgeTransport } from '../bridge/transport.js';
import type { FrontendContextStore } from '../frontend/frontend-context-store.js';
import { structuredResult, toolError } from './result.js';
import type { RegisteredToolMap } from './tool-registry.js';

/** 注册结构索引、workunit 准备和来源新鲜度检查。 */
export function registerFrontendTools(
  server: McpServer,
  broker: BridgeTransport,
  contexts: FrontendContextStore,
): RegisteredToolMap {
  const tools: RegisteredToolMap = {};
  tools.figma_frontend_index_scope = server.registerTool(
    'figma_frontend_index_scope',
    {
      description:
        'Persist a bounded structure-only index for decomposing a large Figma page. The result returns a manifest path, never the JSONL body.',
      inputSchema: IndexScopeInputSchema,
      outputSchema: IndexScopeResultSchema,
      annotations: {
        title: 'Index Figma Frontend Scope',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const parsed = IndexScopeInputSchema.parse(input);
        assertSession(parsed.expectedSessionId, contexts);
        contexts.workspace.beginWrite();
        const rpcInput = IndexScopeRpcInputSchema.parse({
          rootNodeId: parsed.rootNodeId,
          depth: parsed.depth,
          maxNodes: parsed.maxNodes,
          maxTextLength: parsed.maxTextLength,
        });
        const result = IndexScopeRpcResultSchema.parse(
          await broker.request('indexScope', rpcInput, 120_000),
        );
        return structuredResult(IndexScopeResultSchema.parse(await contexts.writeIndex(result)));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  tools.figma_frontend_prepare_workunit = server.registerTool(
    'figma_frontend_prepare_workunit',
    {
      description:
        'Persist immutable implementation facts and create a stable workunit skeleton. Re-preparing refreshes source/current.json but never overwrites implementation.json.',
      inputSchema: PrepareWorkunitInputSchema,
      outputSchema: PrepareWorkunitResultSchema,
      annotations: {
        title: 'Prepare Figma Frontend Workunit',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const parsed = PrepareWorkunitInputSchema.parse(input);
        assertSession(parsed.expectedSessionId, contexts);
        contexts.workspace.beginWrite();
        const rpcInput = PrepareWorkunitRpcInputSchema.parse({
          rootNodeId: parsed.rootNodeId,
          factNodeIds: parsed.factNodeIds,
          includePreview: parsed.includePreview,
          depth: parsed.depth,
          maxNodes: parsed.maxNodes,
          maxTextLength: parsed.maxTextLength,
        });
        const result = PrepareWorkunitRpcResultSchema.parse(
          await broker.request('prepareWorkunitSource', rpcInput, 120_000),
        );
        return structuredResult(
          PrepareWorkunitResultSchema.parse(
            await contexts.prepareWorkunit(result, parsed.fidelityPolicy),
          ),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  tools.figma_frontend_check_workunit_source = server.registerTool(
    'figma_frontend_check_workunit_source',
    {
      description:
        'Check the current Figma subtree against the sourceFingerprint recorded in one workunit implementation file.',
      inputSchema: WorkunitIdInputSchema,
      outputSchema: CheckWorkunitSourceResultSchema,
      annotations: {
        title: 'Check Figma Workunit Source',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const { workUnitId } = WorkunitIdInputSchema.parse(input);
        const target = await contexts.getCheckTarget(workUnitId);
        const rpc = CheckWorkunitSourceRpcResultSchema.parse(
          await broker.request(
            'checkWorkunitSource',
            CheckWorkunitSourceRpcInputSchema.parse(target),
            30_000,
          ),
        );
        return structuredResult(CheckWorkunitSourceResultSchema.parse({ status: rpc.status }));
      } catch (error) {
        return toolError(error);
      }
    },
  );
  return tools;
}

function assertSession(expectedSessionId: string, contexts: FrontendContextStore): void {
  if (expectedSessionId === contexts.workspace.sessionId) return;
  throw new BridgeFault({
    code: 'EXPORT_SESSION_MISMATCH',
    message: 'Frontend context session changed; call figma_status and use the current session.',
    retryable: true,
    details: { expectedSessionId, actualSessionId: contexts.workspace.sessionId },
  });
}
