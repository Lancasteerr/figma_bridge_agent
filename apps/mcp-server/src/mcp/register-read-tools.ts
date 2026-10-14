import {
  CssResultSchema,
  CssRpcResultSchema,
  GetCssInputSchema,
  FontCatalogResultSchema,
  FingerprintResultSchema,
  FingerprintRpcResultSchema,
  GetFingerprintInputSchema,
  GetNodeInputSchema,
  GetRawNodeInputSchema,
  GetTreeInputSchema,
  GetTreeRpcInputSchema,
  NodeResultSchema,
  NodeSnapshotSchema,
  RawNodeResultSchema,
  RawNodeRpcResultSchema,
  TreeResultSchema,
  TreeRpcResultSchema,
  ListFontsInputSchema,
  GetDesignResourcesInputSchema,
  DesignResourcesResultSchema,
} from '@figma-agent/protocol';
import type { McpServer } from '@modelcontextprotocol/server';

import type { BridgeTransport } from '../bridge/transport.js';
import type { TemporaryArtifactStore } from '../temp/artifact-store.js';
import { structuredResult, toolError } from './result.js';
import { deliverTreeResult } from './tree-delivery.js';

/** 注册节点、树、设计资源、CSS 和原始 JSON 等只读工具。 */
export function registerReadTools(
  server: McpServer,
  broker: BridgeTransport,
  artifacts: TemporaryArtifactStore,
): void {
  server.registerTool(
    'figma_get_design_resources',
    {
      description:
        'Return paginated local styles and variables plus reusable components and instances from the current Figma page. Team libraries are never queried.',
      inputSchema: GetDesignResourcesInputSchema,
      outputSchema: DesignResourcesResultSchema,
      annotations: {
        title: 'Get Figma Design Resources',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const parsed = GetDesignResourcesInputSchema.parse(input);
        return structuredResult(
          DesignResourcesResultSchema.parse(
            await broker.request('getDesignResources', parsed, 30_000),
          ),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'figma_list_fonts',
    {
      description:
        'Return a filtered, stable, paginated catalog of fonts currently available to the Figma editor, including variable-font axis tags.',
      inputSchema: ListFontsInputSchema,
      outputSchema: FontCatalogResultSchema,
      annotations: {
        title: 'List Available Figma Fonts',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const parsed = ListFontsInputSchema.parse(input);
        return structuredResult(
          FontCatalogResultSchema.parse(await broker.request('listFonts', parsed, 30_000)),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'figma_get_raw_node',
    {
      description:
        'Return a bounded, self-only JSON_REST_V1 projection for a known unsupported detail. Identity fields are retained; request depth 1 or selected top-level fields explicitly. Prefer normalized snapshots for normal reasoning.',
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
        const rpc = RawNodeRpcResultSchema.parse(
          await broker.request('getRawNode', parsed, 30_000),
        );
        return structuredResult(RawNodeResultSchema.parse({ node: rpc.node }));
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
        const rpc = CssRpcResultSchema.parse(await broker.request('getCss', parsed, 15_000));
        return structuredResult(CssResultSchema.parse({ properties: rpc.properties }));
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
      outputSchema: NodeResultSchema,
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
        const snapshot = NodeSnapshotSchema.parse(
          await broker.request('getNode', GetNodeInputSchema.parse(input)),
        );
        const children = snapshot.children.map(({ id, name, type, geometry }) => ({
          id,
          name,
          type,
          ...(geometry ? { geometry } : {}),
        }));
        const assets =
          snapshot.assets &&
          (snapshot.assets.imagePaints.length > 0 ||
            snapshot.assets.exportSettings.length > 0 ||
            snapshot.assets.vector ||
            snapshot.assets.mask)
            ? snapshot.assets
            : undefined;
        return structuredResult(
          NodeResultSchema.parse({
            name: snapshot.name,
            type: snapshot.type,
            ...(snapshot.parentId ? { parentId: snapshot.parentId } : {}),
            ...(snapshot.geometry ? { geometry: snapshot.geometry } : {}),
            ...(snapshot.visible === undefined ? {} : { visible: snapshot.visible }),
            ...(snapshot.locked === undefined ? {} : { locked: snapshot.locked }),
            ...(snapshot.layout ? { layout: snapshot.layout } : {}),
            ...(snapshot.text ? { text: snapshot.text } : {}),
            ...(snapshot.visual ? { visual: snapshot.visual } : {}),
            children,
            ...(assets ? { assets } : {}),
            ...(snapshot.component ? { component: snapshot.component } : {}),
            snapshotFingerprint: snapshot.fingerprint,
          }),
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
        'Return a bounded lightweight navigation tree. maxTextLength must be an integer from 0 to 80 and defaults to 80. Large results are written to a temporary JSONL file; use get_node or semantic snapshots for implementation facts.',
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
        const rpcInput = GetTreeRpcInputSchema.parse({
          nodeId: parsed.nodeId,
          depth: parsed.depth,
          maxNodes: parsed.maxNodes,
          maxTextLength: parsed.maxTextLength,
        });
        const tree = TreeRpcResultSchema.parse(await broker.request('getTree', rpcInput));
        return structuredResult(await deliverTreeResult(tree, parsed.delivery, artifacts));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'figma_get_fingerprint',
    {
      description:
        'Return the ordered aggregate fingerprint of complete current-page node subtrees. Use it for DesignPlan source.fingerprint and Proposal expectedFingerprint checks.',
      inputSchema: GetFingerprintInputSchema,
      outputSchema: FingerprintResultSchema,
      annotations: {
        title: 'Get Figma aggregate fingerprint',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const parsed = GetFingerprintInputSchema.parse(input);
        const rpc = FingerprintRpcResultSchema.parse(
          await broker.request('getFingerprint', parsed, 30_000),
        );
        return structuredResult(
          FingerprintResultSchema.parse({ treeFingerprint: rpc.fingerprint }),
        );
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
