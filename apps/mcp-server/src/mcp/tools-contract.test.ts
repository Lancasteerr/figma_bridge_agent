import {
  InMemoryTransport,
  LATEST_PROTOCOL_VERSION,
  type JSONRPCMessage,
} from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it } from 'vitest';

import { DaemonBridgeClient } from '../bridge/daemon-client.js';
import { PluginConnectionBroker } from '../bridge/plugin-connection.js';
import { ExportStore } from '../export/export-store.js';
import { TemporaryArtifactStore } from '../temp/artifact-store.js';
import { createMcpServer } from '../server.js';

const EXPECTED_TOOLS = [
  'figma_apply_design_plan',
  'figma_bind_export_root',
  'figma_check_semantic_scope',
  'figma_create_component_from_node',
  'figma_create_frame',
  'figma_discard_proposal',
  'figma_duplicate_as_proposal',
  'figma_export_assets',
  'figma_export_semantic_scope',
  'figma_get_css',
  'figma_get_design_resources',
  'figma_get_fingerprint',
  'figma_get_node',
  'figma_get_raw_node',
  'figma_get_tree',
  'figma_list_fonts',
  'figma_render_node',
  'figma_reparent_nodes',
  'figma_set_instance_properties',
  'figma_set_layout',
  'figma_stage_asset',
  'figma_status',
  'figma_update_text',
  'figma_validate_design_plan',
];
const CONTRACT_SESSION_ID = '33333333-3333-4333-8333-333333333333';

// 该列表刻意形成 closed-world 契约：新增或误删工具都必须显式更新测试和文档。
const servers: ReturnType<typeof createMcpServer>[] = [];
const daemonClients: DaemonBridgeClient[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const client of daemonClients.splice(0)) await client.close();
});

describe('MCP tool contract', () => {
  it('advertises its package version and exactly 24 closed-world tools', async () => {
    const broker = new PluginConnectionBroker({
      version: 2,
      serverId: '11111111-1111-4111-8111-111111111111',
      host: '127.0.0.1',
      port: 39_000,
      daemonSecret: Buffer.alloc(32, 28).toString('base64url'),
      pairedClients: {},
    });
    const mcp = createMcpServer(
      broker,
      new TemporaryArtifactStore({ sessionId: CONTRACT_SESSION_ID }),
      new ExportStore(),
    );
    servers.push(mcp);
    const snapshot = await inspectServer(mcp);
    const tools = snapshot.tools;

    expect(snapshot.serverInfo?.version).toBe(__CLI_VERSION__);

    // 除名称外还检查 schema 和注解，防止工具虽然注册成功但失去客户端元数据。
    expect(tools.map((tool) => tool.name).sort()).toEqual(EXPECTED_TOOLS);
    expect(tools).toHaveLength(24);
    expect(tools.map((tool) => tool.name)).not.toContain('figma_get_selection');
    expect(tools.map((tool) => tool.name)).not.toContain('figma_get_variables');
    for (const tool of tools) {
      expect(tool.inputSchema).toMatchObject({ type: 'object' });
      expect(tool.outputSchema).toMatchObject({ type: 'object' });
      expect(tool.annotations).toMatchObject({ openWorldHint: false });
      const outputProperties = collectPropertyNames(tool.outputSchema);
      for (const forbidden of [
        'sha256',
        'bytes',
        'createdAt',
        'delivery',
        'requiresCopy',
        'projectRelativePath',
        'absolutePath',
        'cloneRoots',
        'requestedTargetIds',
        'idMap',
        'affectedNodeIds',
        'discardedProposalRootId',
        'nodeIds',
        'rootNodeId',
        'pageId',
        'cursor',
        'total',
        'scannedNodeCount',
        'scanTruncated',
        'fingerprint',
      ]) {
        expect(outputProperties, `${tool.name} exposes ${forbidden}`).not.toContain(forbidden);
      }
      expect(JSON.stringify(tool.outputSchema), `${tool.name} exposes STAGED`).not.toContain(
        'STAGED',
      );
    }
    expect(tools.find((tool) => tool.name === 'figma_discard_proposal')?.annotations).toMatchObject(
      { destructiveHint: true },
    );
    const duplicate = tools.find((tool) => tool.name === 'figma_duplicate_as_proposal');
    expect(duplicate?.inputSchema).toMatchObject({
      properties: { editTargetNodeIds: expect.any(Object) },
    });
    expect(
      (duplicate?.inputSchema as { properties?: Record<string, unknown> }).properties,
    ).not.toHaveProperty('nodeIds');
    expect(duplicate?.outputSchema).toMatchObject({
      properties: {
        targetMap: expect.any(Object),
        warnings: expect.any(Object),
        proposalFingerprint: expect.any(Object),
      },
    });
    expect(
      (duplicate?.outputSchema as { properties?: Record<string, unknown> }).properties,
    ).not.toHaveProperty('idMap');
    const fingerprint = tools.find((tool) => tool.name === 'figma_get_fingerprint');
    expect(fingerprint?.inputSchema).toMatchObject({
      properties: { nodeIds: expect.any(Object) },
    });
    expect(fingerprint?.outputSchema).toMatchObject({
      properties: { treeFingerprint: expect.any(Object) },
    });
    expect(fingerprint?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    });
    expect(tools.find((tool) => tool.name === 'figma_export_assets')?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    });
    expect(tools.map((tool) => tool.name)).not.toContain('figma_export_asset');
    expect(tools.find((tool) => tool.name === 'figma_export_assets')?.outputSchema).toMatchObject({
      properties: { assets: expect.any(Object) },
    });
    expect(tools.find((tool) => tool.name === 'figma_bind_export_root')?.annotations).toMatchObject(
      {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    );

    const render = tools.find((tool) => tool.name === 'figma_render_node');
    expect(render?.outputSchema).toMatchObject({
      properties: {
        localPath: expect.any(Object),
        width: expect.any(Object),
        height: expect.any(Object),
        expiresAt: expect.any(Object),
      },
    });
    expect(
      (render?.outputSchema as { properties?: Record<string, unknown> }).properties,
    ).not.toHaveProperty('data');

    const tree = tools.find((tool) => tool.name === 'figma_get_tree');
    expect(tree?.description).toContain(
      'maxTextLength must be an integer from 0 to 80 and defaults to 80.',
    );
    expect(tree?.inputSchema).toMatchObject({
      properties: {
        delivery: expect.any(Object),
        maxTextLength: {
          type: 'integer',
          minimum: 0,
          maximum: 80,
          default: 80,
        },
      },
    });
    expect(tree?.outputSchema).toMatchObject({
      properties: {
        root: expect.any(Object),
        truncation: expect.any(Object),
        artifact: expect.any(Object),
      },
    });

    const validatePlan = tools.find((tool) => tool.name === 'figma_validate_design_plan');
    const validateInput = validatePlan?.inputSchema as {
      properties?: {
        plan?: { properties?: { root?: { $ref?: string } } };
      };
      $defs?: Record<
        string,
        {
          properties?: {
            kind?: { const?: string };
            children?: {
              items?: {
                oneOf?: Array<{
                  $ref?: string;
                  properties?: { kind?: { const?: string; enum?: string[] } };
                }>;
              };
            };
          };
        }
      >;
    };
    const rootRef = validateInput.properties?.plan?.properties?.root?.$ref;
    expect(rootRef).toMatch(/^#\/\$defs\//);
    const rootDefinition = rootRef?.split('/').at(-1);
    const root = rootDefinition ? validateInput.$defs?.[rootDefinition] : undefined;
    expect(root?.properties?.kind?.const).toBe('FRAME');
    const variants = root?.properties?.children?.items?.oneOf;
    const kinds = variants?.flatMap((variant) => {
      if (variant.$ref === rootRef) return ['FRAME'];
      const kind = variant.properties?.kind;
      return kind?.const ? [kind.const] : (kind?.enum ?? []);
    });
    expect(kinds?.sort()).toEqual(
      ['CLONE', 'ELLIPSE', 'FRAME', 'IMAGE', 'INSTANCE', 'LINE', 'RECTANGLE', 'SVG', 'TEXT'].sort(),
    );
    expect(variants).toContainEqual({ $ref: rootRef });
    expect(validatePlan?.inputSchema).toMatchObject({
      properties: { returnRefs: expect.any(Object) },
    });
    const applyPlan = tools.find((tool) => tool.name === 'figma_apply_design_plan');
    expect(applyPlan?.outputSchema).toMatchObject({
      properties: {
        proposalRootId: expect.any(Object),
        refMap: expect.any(Object),
        proposalFingerprint: expect.any(Object),
      },
    });
  });

  it('advertises all tools for three independent MCP sessions before the daemon is ready', async () => {
    const toolSets = await Promise.all(
      Array.from({ length: 3 }, async () => {
        const client = new DaemonBridgeClient(
          {
            version: 2,
            serverId: '11111111-1111-4111-8111-111111111111',
            host: '127.0.0.1',
            port: 39_099,
            daemonSecret: Buffer.alloc(32, 29).toString('base64url'),
            pairedClients: {},
          },
          { autoStart: false, connectTimeoutMs: 20, spawnDaemon: () => undefined },
        );
        daemonClients.push(client);
        const mcp = createMcpServer(
          client,
          new TemporaryArtifactStore({ sessionId: CONTRACT_SESSION_ID }),
          new ExportStore(),
        );
        servers.push(mcp);
        return (await listTools(mcp)).map((tool) => tool.name).sort();
      }),
    );

    for (const tools of toolSets) expect(tools).toEqual(EXPECTED_TOOLS);
  });
});

interface ListedTool {
  name: string;
  description?: string;
  inputSchema: unknown;
  outputSchema: unknown;
  annotations?: Record<string, unknown>;
}

interface ServerInfo {
  name?: string;
  version?: string;
}

interface ServerSnapshot {
  serverInfo: ServerInfo | undefined;
  tools: ListedTool[];
}

/** 递归读取 JSON Schema 的 properties，防止内部记账字段藏在嵌套输出中。 */
function collectPropertyNames(schema: unknown, names = new Set<string>()): Set<string> {
  if (!schema || typeof schema !== 'object') return names;
  const object = schema as Record<string, unknown>;
  if (object.properties && typeof object.properties === 'object') {
    for (const key of Object.keys(object.properties)) names.add(key);
  }
  for (const value of Object.values(object)) {
    if (Array.isArray(value)) {
      for (const item of value) collectPropertyNames(item, names);
    } else {
      collectPropertyNames(value, names);
    }
  }
  return names;
}

async function listTools(server: ReturnType<typeof createMcpServer>): Promise<ListedTool[]> {
  return (await inspectServer(server)).tools;
}

async function inspectServer(server: ReturnType<typeof createMcpServer>): Promise<ServerSnapshot> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const responses = new Map<number, (message: JSONRPCMessage) => void>();
  clientTransport.onmessage = (message) => {
    if ('id' in message && typeof message.id === 'number') responses.get(message.id)?.(message);
  };
  await clientTransport.start();
  await server.connect(serverTransport);
  const initializeMessage = await request(clientTransport, responses, 1, 'initialize', {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'contract-test', version: '1.0.0' },
  });
  if (!('result' in initializeMessage)) {
    throw new Error('initialize did not return a result.');
  }
  const initializeResult = initializeMessage.result as { serverInfo?: ServerInfo };
  await clientTransport.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const message = await request(clientTransport, responses, 2, 'tools/list', {});
  if (!('result' in message)) throw new Error('tools/list did not return a result.');
  const result = message.result as { tools?: ListedTool[] };
  if (!Array.isArray(result.tools)) throw new Error('tools/list returned no tools array.');
  return { serverInfo: initializeResult.serverInfo, tools: result.tools };
}

async function request(
  transport: InMemoryTransport,
  responses: Map<number, (message: JSONRPCMessage) => void>,
  id: number,
  method: string,
  params: Record<string, unknown>,
): Promise<JSONRPCMessage> {
  const result = new Promise<JSONRPCMessage>((resolve) => responses.set(id, resolve));
  await transport.send({ jsonrpc: '2.0', id, method, params });
  const message = await result;
  responses.delete(id);
  return message;
}
