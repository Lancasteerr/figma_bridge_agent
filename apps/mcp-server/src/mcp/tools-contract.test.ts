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
import {
  DESIGN_TOOL_NAMES,
  FRONTEND_TOOL_NAMES,
  INSPECT_TOOL_NAMES,
} from './register-workflow-tool.js';

const BASE_TOOLS = ['figma_activate_workflow', 'figma_status'];
const CONTRACT_SESSION_ID = '33333333-3333-4333-8333-333333333333';
const servers: ReturnType<typeof createMcpServer>[] = [];
const daemonClients: DaemonBridgeClient[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const client of daemonClients.splice(0)) await client.close();
});

describe('MCP tool contract', () => {
  it('冷启动只暴露状态和工作流激活工具', async () => {
    const { mcp } = createTestServer();
    const client = await connectServer(mcp);
    const tools = await client.listTools();

    expect(client.serverInfo?.version).toBe(__CLI_VERSION__);
    expect(namesOf(tools)).toEqual(BASE_TOOLS);
    expect(tools).toHaveLength(2);
    expect(
      tools.find((tool) => tool.name === 'figma_activate_workflow')?.inputSchema,
    ).toMatchObject({
      properties: { workflow: { enum: ['INSPECT', 'FRONTEND', 'DESIGN'] } },
    });
    expect(
      tools.find((tool) => tool.name === 'figma_activate_workflow')?.annotations,
    ).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(JSON.stringify(tools).length).toBeLessThanOrEqual(5_000);
  });

  it('按连接切换三个工作流并原生发送 tools/list_changed', async () => {
    const { mcp, broker, exports } = createTestServer();
    const client = await connectServer(mcp);

    await expectActivation(client, 'INSPECT', expectedNames(INSPECT_TOOL_NAMES));
    const firstNotificationCount = client.listChangedCount();
    expect(firstNotificationCount).toBeGreaterThan(0);

    // 重复激活不切换句柄，因此不会产生额外的列表变更通知。
    await expectActivation(client, 'INSPECT', expectedNames(INSPECT_TOOL_NAMES));
    expect(client.listChangedCount()).toBe(firstNotificationCount);

    await expectActivation(client, 'FRONTEND', expectedNames(FRONTEND_TOOL_NAMES));
    const frontendTools = await client.listTools();
    expect(JSON.stringify(frontendTools).length).toBeLessThanOrEqual(45_000);
    expect(
      frontendTools.find((tool) => tool.name === 'figma_frontend_export_assets')?.annotations,
    ).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    });
    const nodeSchema = frontendTools.find(
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

    await expectActivation(client, 'DESIGN', expectedNames(DESIGN_TOOL_NAMES));
    const designTools = await client.listTools();
    expect(JSON.stringify(designTools).length).toBeLessThanOrEqual(55_000);
    expect(
      designTools.find((tool) => tool.name === 'figma_design_discard_proposal')?.annotations,
    ).toMatchObject({
      destructiveHint: true,
    });
    const validatePlan = designTools.find((tool) => tool.name === 'figma_design_validate_plan');
    const validateSchema = JSON.stringify(validatePlan?.inputSchema);
    expect(validateSchema.length).toBeLessThan(5_000);
    expect(validateSchema).toContain('Complete DesignPlan JSON');
    expect(validateSchema).not.toContain('"kind"');

    const beforeSwitch = client.listChangedCount();
    await expectActivation(client, 'INSPECT', expectedNames(INSPECT_TOOL_NAMES));
    expect(client.listChangedCount()).toBeGreaterThan(beforeSwitch);
    const disabled = await client.callTool('figma_frontend_export_assets', { items: [] });
    expect(disabled).toHaveProperty('error');

    // 激活过程只操作本地句柄，不访问 Figma，也不改变工作区绑定。
    expect(broker.request).not.toHaveBeenCalled();
    expect(exports.status.state).toBe('UNBOUND');
  });

  it('每个未激活的 MCP 连接都保持独立冷启动集合', async () => {
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

    for (const tools of toolSets) expect(tools).toEqual(BASE_TOOLS);
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

type Workflow = 'INSPECT' | 'FRONTEND' | 'DESIGN';

/** 创建不会实际连接 Figma 的服务端，便于证明激活路径没有外部副作用。 */
function createTestServer() {
  const broker = {
    connected: false,
    pluginVersion: undefined,
    request: vi.fn(async () => {
      throw new Error('Workflow activation must not call the broker.');
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
  return { mcp, broker, exports };
}

function expectedNames(workflowTools: readonly string[]): string[] {
  return [...BASE_TOOLS, ...workflowTools].sort();
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

async function expectActivation(
  client: Awaited<ReturnType<typeof connectServer>>,
  workflow: Workflow,
  expected: string[],
): Promise<void> {
  const message = await client.callTool('figma_activate_workflow', { workflow });
  if (!('result' in message)) throw new Error(`Activation failed: ${JSON.stringify(message)}`);
  const result = message.result as {
    isError?: boolean;
    structuredContent?: { workflow?: string; enabledTools?: string[] };
  };
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toEqual({ workflow, enabledTools: expected });
  expect(namesOf(await client.listTools())).toEqual(expected);
}

/** 建立一个最小 MCP 客户端并保留列表变更通知，覆盖真实 SDK 行为。 */
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
