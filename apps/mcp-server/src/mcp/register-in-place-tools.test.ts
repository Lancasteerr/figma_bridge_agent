import type { McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it, vi } from 'vitest';
import type { BridgeTransport } from '../bridge/transport.js';
import { registerInPlaceTools } from './register-in-place-tools.js';

type Handler = (input: unknown) => Promise<unknown>;
function setup() {
  const handlers = new Map<string, Handler>();
  const definitions = new Map<string, unknown>();
  const server = {
    registerTool: (name: string, definition: unknown, handler: Handler) => {
      handlers.set(name, handler);
      definitions.set(name, definition);
    },
  } as unknown as McpServer;
  const broker = { request: vi.fn() } as unknown as BridgeTransport & {
    request: ReturnType<typeof vi.fn>;
  };
  registerInPlaceTools(server, broker);
  return { handlers, definitions, broker };
}
const guard = { scopeRootId: 'root', expectedFingerprint: '12345678', editMode: 'IN_PLACE' };
describe('in-place MCP tools', () => {
  it('marks both original-artwork tools destructive and non-idempotent', () => {
    const { definitions } = setup();
    for (const definition of definitions.values())
      expect(definition).toMatchObject({
        annotations: { destructiveHint: true, readOnlyHint: false, idempotentHint: false },
      });
  });
  it('forwards validated edits and returns a reusable fingerprint', async () => {
    const { handlers, broker } = setup();
    broker.request.mockResolvedValue({
      scopeRootId: 'root',
      treeFingerprint: 'updated-fingerprint',
      createdNodeIds: [],
    });
    const input = {
      ...guard,
      operations: [{ type: 'TEXT', nodeId: 'text', characters: 'Updated' }],
    };
    await expect(handlers.get('figma_design_edit_in_place')!(input)).resolves.toMatchObject({
      structuredContent: { treeFingerprint: 'updated-fingerprint' },
    });
    expect(broker.request).toHaveBeenCalledWith('editInPlace', input, 30_000);
  });
  it('returns root deletion explicitly and rejects invalid inputs before RPC', async () => {
    const { handlers, broker } = setup();
    broker.request.mockResolvedValue({
      deletedNodeIds: ['root'],
      scopeRemoved: true,
      treeFingerprint: null,
    });
    await expect(
      handlers.get('figma_design_delete_nodes')!({ ...guard, nodeIds: ['root'] }),
    ).resolves.toMatchObject({ structuredContent: { scopeRemoved: true, treeFingerprint: null } });
    broker.request.mockClear();
    await expect(
      handlers.get('figma_design_delete_nodes')!({ nodeIds: ['root'] }),
    ).resolves.toMatchObject({ isError: true });
    expect(broker.request).not.toHaveBeenCalled();
  });
  it('surfaces stale-scope errors without retrying a write', async () => {
    const { handlers, broker } = setup();
    broker.request.mockRejectedValue(new Error('scope changed'));
    await expect(
      handlers.get('figma_design_delete_nodes')!({ ...guard, nodeIds: ['text'] }),
    ).resolves.toMatchObject({ isError: true });
    expect(broker.request).toHaveBeenCalledTimes(1);
  });
});
