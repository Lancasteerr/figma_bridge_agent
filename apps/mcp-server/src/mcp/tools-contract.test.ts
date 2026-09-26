import {
  InMemoryTransport,
  LATEST_PROTOCOL_VERSION,
  type JSONRPCMessage,
} from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it } from 'vitest';

import { PluginConnectionBroker } from '../bridge/plugin-connection.js';
import { TempAssetStore } from '../temp/asset-store.js';
import { createMcpServer } from '../server.js';

const EXPECTED_TOOLS = [
  'figma_apply_layout_plan',
  'figma_create_component_from_node',
  'figma_create_frame',
  'figma_discard_proposal',
  'figma_duplicate_as_proposal',
  'figma_export_asset',
  'figma_get_css',
  'figma_get_node',
  'figma_get_raw_node',
  'figma_get_selection',
  'figma_get_tree',
  'figma_get_variables',
  'figma_render_node',
  'figma_reparent_nodes',
  'figma_set_instance_properties',
  'figma_set_layout',
  'figma_status',
  'figma_update_text',
  'figma_validate_layout_plan',
];

const servers: ReturnType<typeof createMcpServer>[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});

describe('MCP tool contract', () => {
  it('advertises exactly 19 closed-world tools with schemas and annotations', async () => {
    const broker = new PluginConnectionBroker({
      version: 1,
      host: '127.0.0.1',
      port: 39_000,
      secret: 'unused-test-secret',
    });
    const mcp = createMcpServer(broker, new TempAssetStore());
    servers.push(mcp);
    const tools = await listTools(mcp);

    expect(tools.map((tool) => tool.name).sort()).toEqual(EXPECTED_TOOLS);
    expect(tools).toHaveLength(19);
    for (const tool of tools) {
      expect(tool.inputSchema).toMatchObject({ type: 'object' });
      expect(tool.outputSchema).toMatchObject({ type: 'object' });
      expect(tool.annotations).toMatchObject({ openWorldHint: false });
    }
    expect(tools.find((tool) => tool.name === 'figma_discard_proposal')?.annotations).toMatchObject(
      { destructiveHint: true },
    );
  });
});

interface ListedTool {
  name: string;
  inputSchema: unknown;
  outputSchema: unknown;
  annotations?: Record<string, unknown>;
}

async function listTools(server: ReturnType<typeof createMcpServer>): Promise<ListedTool[]> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const responses = new Map<number, (message: JSONRPCMessage) => void>();
  clientTransport.onmessage = (message) => {
    if ('id' in message && typeof message.id === 'number') responses.get(message.id)?.(message);
  };
  await clientTransport.start();
  await server.connect(serverTransport);
  await request(clientTransport, responses, 1, 'initialize', {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'contract-test', version: '1.0.0' },
  });
  await clientTransport.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const message = await request(clientTransport, responses, 2, 'tools/list', {});
  if (!('result' in message)) throw new Error('tools/list did not return a result.');
  const result = message.result as { tools?: ListedTool[] };
  if (!Array.isArray(result.tools)) throw new Error('tools/list returned no tools array.');
  return result.tools;
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
