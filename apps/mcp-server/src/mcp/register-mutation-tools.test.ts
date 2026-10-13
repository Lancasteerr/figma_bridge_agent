import type { McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it, vi } from 'vitest';

import type { BridgeTransport } from '../bridge/transport.js';
import { registerMutationTools } from './register-mutation-tools.js';

type ToolHandler = (input: Record<string, unknown>) => Promise<{
  isError?: boolean;
  content: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
}>;

function setup(results: Record<string, Record<string, unknown>>) {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    registerTool: (name: string, _definition: unknown, handler: ToolHandler) => {
      handlers.set(name, handler);
    },
  } as unknown as McpServer;
  const broker = {
    request: vi.fn(async (method: string) => results[method]),
  } as unknown as BridgeTransport;
  registerMutationTools(server, broker);
  return handlers;
}

describe('Proposal mutation public results', () => {
  it('创建 Frame 返回节点 ID，其余 mutation 只推进 Proposal 指纹', async () => {
    const handlers = setup({
      createFrame: { nodeId: 'frame-1', proposalFingerprint: 'fingerprint-1' },
      reparentNodes: { proposalFingerprint: 'fingerprint-2' },
      setLayout: { proposalFingerprint: 'fingerprint-3' },
      setInstanceProperties: { proposalFingerprint: 'fingerprint-4' },
      updateText: { proposalFingerprint: 'fingerprint-5' },
    });

    await expect(
      handlers.get('figma_create_frame')!({
        proposalRootId: 'proposal',
        parentId: 'proposal',
        name: 'Frame',
      }),
    ).resolves.toMatchObject({
      structuredContent: { nodeId: 'frame-1', proposalFingerprint: 'fingerprint-1' },
    });
    await expect(
      handlers.get('figma_reparent_nodes')!({
        proposalRootId: 'proposal',
        nodeIds: ['node-1'],
        parentId: 'parent-1',
        placement: 'FLOW',
      }),
    ).resolves.toMatchObject({ structuredContent: { proposalFingerprint: 'fingerprint-2' } });
    await expect(
      handlers.get('figma_set_layout')!({ proposalRootId: 'proposal', nodeId: 'node-1' }),
    ).resolves.toMatchObject({ structuredContent: { proposalFingerprint: 'fingerprint-3' } });
    await expect(
      handlers.get('figma_set_instance_properties')!({
        proposalRootId: 'proposal',
        nodeId: 'node-1',
        properties: {},
      }),
    ).resolves.toMatchObject({ structuredContent: { proposalFingerprint: 'fingerprint-4' } });
    await expect(
      handlers.get('figma_update_text')!({
        proposalRootId: 'proposal',
        nodeId: 'node-1',
        characters: 'Updated',
      }),
    ).resolves.toMatchObject({ structuredContent: { proposalFingerprint: 'fingerprint-5' } });
  });

  it('组件仅在替换根时返回新根，discard 成功返回空对象', async () => {
    const handlers = setup({
      createComponentFromNode: {
        componentId: 'component-1',
        newProposalRootId: 'component-1',
        proposalFingerprint: 'fingerprint-6',
      },
      discardProposal: {},
    });

    await expect(
      handlers.get('figma_create_component_from_node')!({
        proposalRootId: 'proposal',
        nodeId: 'proposal',
      }),
    ).resolves.toMatchObject({
      structuredContent: {
        componentId: 'component-1',
        newProposalRootId: 'component-1',
        proposalFingerprint: 'fingerprint-6',
      },
    });
    await expect(
      handlers.get('figma_discard_proposal')!({
        proposalRootId: 'proposal',
        expectedFingerprint: 'fingerprint-6',
      }),
    ).resolves.toMatchObject({ structuredContent: {} });
  });
});
