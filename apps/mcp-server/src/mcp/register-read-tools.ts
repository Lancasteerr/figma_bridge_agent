import {
  CssResultSchema,
  EmptyInputSchema,
  GetCssInputSchema,
  GetVariablesInputSchema,
  GetNodeInputSchema,
  GetRawNodeInputSchema,
  GetTreeInputSchema,
  NodeSnapshotSchema,
  RawNodeResultSchema,
  SelectionResultSchema,
  TreeResultSchema,
  VariablesResultSchema,
} from '@figma-agent/protocol';
import type { McpServer } from '@modelcontextprotocol/server';

import type { BridgeTransport } from '../bridge/transport.js';
import { structuredResult, toolError } from './result.js';

/** 注册节点、树、变量、CSS 和原始 JSON 等只读工具。 */
export function registerReadTools(server: McpServer, broker: BridgeTransport): void {
  server.registerTool(
    'figma_get_raw_node',
    {
      description:
        'Return bounded JSON_REST_V1 for debugging unsupported node details. Prefer normalized snapshots for normal reasoning.',
      inputSchema: GetRawNodeInputSchema,
      outputSchema: RawNodeResultSchema,
      annotations: {
        title: 'Get Raw Figma Node',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const parsed = GetRawNodeInputSchema.parse(input);
        return structuredResult(
          RawNodeResultSchema.parse(await broker.request('getRawNode', parsed, 30_000)),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'figma_get_variables',
    {
      description:
        'Return a page of local Figma variables plus their local collections. Team library crawling is intentionally excluded.',
      inputSchema: GetVariablesInputSchema,
      outputSchema: VariablesResultSchema,
      annotations: {
        title: 'Get Local Figma Variables',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const parsed = GetVariablesInputSchema.parse(input);
        return structuredResult(
          VariablesResultSchema.parse(await broker.request('getVariables', parsed, 30_000)),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'figma_get_css',
    {
      description:
        'Return Figma Inspect CSS for a node as a code-generation hint. NodeSnapshot remains the structural source of truth.',
      inputSchema: GetCssInputSchema,
      outputSchema: CssResultSchema,
      annotations: {
        title: 'Get Figma CSS Hint',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const parsed = GetCssInputSchema.parse(input);
        return structuredResult(
          CssResultSchema.parse(await broker.request('getCss', parsed, 15_000)),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'figma_get_selection',
    {
      description:
        'Return summaries for the nodes selected on the current page without traversing subtrees.',
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

  server.registerTool(
    'figma_get_node',
    {
      description:
        'Return a normalized snapshot of one node on the current Figma page, including geometry, layout, text, visual, component, and direct-child summaries.',
      inputSchema: GetNodeInputSchema,
      outputSchema: NodeSnapshotSchema,
      annotations: {
        title: 'Get Figma node',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        return structuredResult(
          NodeSnapshotSchema.parse(
            await broker.request('getNode', GetNodeInputSchema.parse(input)),
          ),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'figma_get_tree',
    {
      description:
        'Return a bounded normalized subtree from the current Figma page. Use depth and node limits to control context size.',
      inputSchema: GetTreeInputSchema,
      outputSchema: TreeResultSchema,
      annotations: {
        title: 'Get Figma subtree',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const parsed = GetTreeInputSchema.parse(input);
        return structuredResult(TreeResultSchema.parse(await broker.request('getTree', parsed)));
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
