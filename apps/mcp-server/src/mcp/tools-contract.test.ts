import {
  InMemoryTransport,
  LATEST_PROTOCOL_VERSION,
  type JSONRPCMessage,
} from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BridgeTransport } from '../bridge/transport.js';
import { DaemonBridgeClient } from '../bridge/daemon-client.js';
import { ExportStore } from '../export/export-store.js';
import { TemporaryArtifactStore } from '../temp/artifact-store.js';
import { createMcpServer } from '../server.js';

const CONTRACT_SESSION_ID = '33333333-3333-4333-8333-333333333333';
const STATIC_TOOL_NAMES = [
  'figma_status',
  'figma_inspect_browse_nodes',
  'figma_inspect_read_node_facts',
  'figma_inspect_read_css_hint',
  'figma_inspect_render_preview',
  'figma_inspect_read_raw_fields',
  'figma_inspect_read_design_resources',
  'figma_inspect_list_fonts',
  'figma_frontend_bind_workspace',
  'figma_frontend_index_scope',
  'figma_frontend_prepare_workunit',
  'figma_frontend_check_workunit_source',
  'figma_frontend_export_assets',
  'figma_design_read_source_fingerprint',
  'figma_design_stage_asset',
  'figma_design_duplicate_as_proposal',
  'figma_design_create_frame',
  'figma_design_reparent_nodes',
  'figma_design_set_layout',
  'figma_design_update_text',
  'figma_design_set_instance_properties',
  'figma_design_create_component_from_node',
  'figma_design_discard_proposal',
  'figma_design_validate_plan',
  'figma_design_apply_plan',
].sort();
const LEGACY_TOOL_NAMES = [
  'figma_activate_workflow',
  'figma_get_tree',
  'figma_get_node',
  'figma_get_css',
  'figma_render_node',
  'figma_get_raw_node',
  'figma_get_design_resources',
  'figma_list_fonts',
  'figma_get_fingerprint',
  'figma_bind_export_root',
  'figma_export_semantic_scope',
  'figma_check_semantic_scope',
  'figma_export_assets',
  'figma_stage_asset',
  'figma_duplicate_as_proposal',
  'figma_create_frame',
  'figma_reparent_nodes',
  'figma_set_layout',
  'figma_update_text',
  'figma_set_instance_properties',
  'figma_create_component_from_node',
  'figma_discard_proposal',
  'figma_validate_design_plan',
  'figma_apply_design_plan',
];
const servers: ReturnType<typeof createMcpServer>[] = [];
const daemonClients: DaemonBridgeClient[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const client of daemonClients.splice(0)) await client.close();
});

describe('MCP tool contract', () => {
  it('冷启动静态公开全部领域工具且不存在激活入口', async () => {
    const { mcp, broker } = createTestServer();
    const client = await connectServer(mcp);
    const tools = await client.listTools();

    expect(client.serverInfo?.version).toBe(__CLI_VERSION__);
    expect(namesOf(tools)).toEqual(STATIC_TOOL_NAMES);
    expect(tools).toHaveLength(STATIC_TOOL_NAMES.length);
    expect(tools.every((tool) => allowedPrefix(tool.name))).toBe(true);
    expect(tools.find((tool) => tool.name === 'figma_activate_workflow')).toBeUndefined();
    expect(client.listChangedCount()).toBe(0);
    expect(broker.request).not.toHaveBeenCalled();
  });

  it('保留关键 schema 与 destructive annotations', async () => {
    const { mcp } = createTestServer();
    const tools = await (await connectServer(mcp)).listTools();
    expect(
      tools.find((tool) => tool.name === 'figma_frontend_export_assets')?.annotations,
    ).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: true });
    const exportAssetsSchema = JSON.stringify(
      tools.find((tool) => tool.name === 'figma_frontend_export_assets')?.inputSchema,
    );
    expect(exportAssetsSchema).toContain('workUnitId');
    expect(exportAssetsSchema).not.toContain('sourceGuard');

    const nodeSchema = tools.find(
      (tool) => tool.name === 'figma_inspect_read_node_facts',
    )?.outputSchema;
    expect(propertyDescriptions(nodeSchema, 'inParent')).toContain(
      'Bounds in the immediate parent coordinate system; use for parent-child layout.',
    );
    expect(propertyDescriptions(nodeSchema, 'onPage')).toContain(
      'Bounds in Figma Page coordinates; use for positioning nodes on the page.',
    );
    expect(propertyDescriptions(nodeSchema, 'renderOnPage')).toContain(
      'Visible ink bounds in Figma Page coordinates, including outer strokes and effects such as shadows.',
    );
    expect(
      tools.find((tool) => tool.name === 'figma_design_discard_proposal')?.annotations,
    ).toMatchObject({ destructiveHint: true });
    const validateSchema = JSON.stringify(
      tools.find((tool) => tool.name === 'figma_design_validate_plan')?.inputSchema,
    );
    expect(validateSchema.length).toBeLessThan(5_000);
    expect(validateSchema).toContain('Complete DesignPlan JSON');
  });

  it('公开 output schema 不声明内部摘要、正文或未授权路径', async () => {
    const { mcp } = createTestServer();
    const tools = await (await connectServer(mcp)).listTools();
    const forbidden = new Set([
      'sha256',
      'digest',
      'bytes',
      'data',
      'dataBase64',
      'svgText',
      'outlineJsonl',
      'factsJsonl',
      'manifestPath',
      'outlinePath',
      'factsPath',
      'previewPath',
      'workspaceRoot',
      'sourceGuard',
    ]);

    for (const tool of tools) {
      const exposed = schemaPropertyNames(tool.outputSchema);
      expect(
        [...exposed].filter((name) => forbidden.has(name)),
        `${tool.name} 暴露了内部 output 字段`,
      ).toEqual([]);
    }
  });

  it('全部旧工具名都未注册且调用被拒绝', async () => {
    const { mcp } = createTestServer();
    const client = await connectServer(mcp);
    const listed = namesOf(await client.listTools());
    for (const legacyName of LEGACY_TOOL_NAMES) {
      expect(listed).not.toContain(legacyName);
      await expect(client.callTool(legacyName, {})).resolves.toHaveProperty('error');
    }
  });

  it('多个连接得到相同的静态工具集合', async () => {
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
        return namesOf(await (await connectServer(mcp)).listTools());
      }),
    );
    for (const tools of toolSets) expect(tools).toEqual(STATIC_TOOL_NAMES);
  });
});

interface ListedTool {
  name: string;
  inputSchema: unknown;
  outputSchema: unknown;
  annotations?: Record<string, unknown>;
}

interface ServerInfo {
  name?: string;
  version?: string;
}

/** 递归收集 JSON Schema 中实际公开的属性名，忽略描述文本中的技术词。 */
function schemaPropertyNames(value: unknown, result = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) schemaPropertyNames(item, result);
    return result;
  }
  if (!value || typeof value !== 'object') return result;
  const record = value as Record<string, unknown>;
  if (record.properties && typeof record.properties === 'object') {
    for (const name of Object.keys(record.properties)) result.add(name);
  }
  for (const child of Object.values(record)) schemaPropertyNames(child, result);
  return result;
}

/** 创建不会实际连接 Figma 的服务端，证明静态工具枚举没有外部副作用。 */
function createTestServer() {
  const broker = {
    connected: false,
    pluginVersion: undefined,
    request: vi.fn(async () => {
      throw new Error('Listing static tools must not call the broker.');
    }),
    onEvent: vi.fn(() => () => undefined),
    close: vi.fn(async () => undefined),
  } as unknown as BridgeTransport;
  const exports = new ExportStore();
  const mcp = createMcpServer(
    broker,
    new TemporaryArtifactStore({ sessionId: CONTRACT_SESSION_ID }),
    exports,
  );
  servers.push(mcp);
  return { mcp, broker };
}

function allowedPrefix(name: string): boolean {
  return (
    name === 'figma_status' ||
    name.startsWith('figma_inspect_') ||
    name.startsWith('figma_frontend_') ||
    name.startsWith('figma_design_')
  );
}

function namesOf(tools: ListedTool[]): string[] {
  return tools.map((tool) => tool.name).sort();
}

/** 递归收集指定属性的公开描述，兼容 Zod 生成的内联和定义引用结构。 */
function propertyDescriptions(
  schema: unknown,
  name: string,
  descriptions: string[] = [],
): string[] {
  if (!schema || typeof schema !== 'object') return descriptions;
  const object = schema as Record<string, unknown>;
  if (object.properties && typeof object.properties === 'object') {
    const property = (object.properties as Record<string, unknown>)[name];
    if (property && typeof property === 'object') {
      const description = (property as Record<string, unknown>).description;
      if (typeof description === 'string') descriptions.push(description);
    }
  }
  for (const value of Object.values(object)) {
    if (Array.isArray(value)) {
      for (const item of value) propertyDescriptions(item, name, descriptions);
    } else {
      propertyDescriptions(value, name, descriptions);
    }
  }
  return descriptions;
}

/** 建立最小 MCP 客户端，并记录不应出现的工具列表变更通知。 */
async function connectServer(server: ReturnType<typeof createMcpServer>) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const responses = new Map<number, (message: JSONRPCMessage) => void>();
  const notifications: JSONRPCMessage[] = [];
  let nextId = 1;
  clientTransport.onmessage = (message) => {
    if ('id' in message && typeof message.id === 'number') responses.get(message.id)?.(message);
    else notifications.push(message);
  };
  await clientTransport.start();
  await server.connect(serverTransport);
  const initialize = await send('initialize', {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: { tools: { listChanged: true } },
    clientInfo: { name: 'contract-test', version: '1.0.0' },
  });
  if (!('result' in initialize)) throw new Error('initialize did not return a result.');
  const serverInfo = (initialize.result as { serverInfo?: ServerInfo }).serverInfo;
  await clientTransport.send({ jsonrpc: '2.0', method: 'notifications/initialized' });

  return {
    serverInfo,
    listChangedCount: () =>
      notifications.filter(
        (message) => 'method' in message && message.method === 'notifications/tools/list_changed',
      ).length,
    async listTools(): Promise<ListedTool[]> {
      const message = await send('tools/list', {});
      if (!('result' in message)) throw new Error('tools/list did not return a result.');
      const result = message.result as { tools?: ListedTool[] };
      if (!Array.isArray(result.tools)) throw new Error('tools/list returned no tools array.');
      return result.tools;
    },
    callTool(name: string, args: Record<string, unknown>) {
      return send('tools/call', { name, arguments: args });
    },
  };

  async function send(method: string, params: Record<string, unknown>): Promise<JSONRPCMessage> {
    const id = nextId++;
    const result = new Promise<JSONRPCMessage>((resolve) => responses.set(id, resolve));
    await clientTransport.send({ jsonrpc: '2.0', id, method, params });
    const message = await result;
    responses.delete(id);
    return message;
  }
}
