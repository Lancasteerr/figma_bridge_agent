import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { McpServer } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BridgeTransport } from '../bridge/transport.js';
import { SemanticSnapshotStore } from '../semantic/semantic-snapshot-store.js';
import { SessionWorkspace } from '../storage/session-workspace.js';
import { registerSemanticTools } from './register-semantic-tools.js';

type ToolHandler = (input: Record<string, unknown>) => Promise<{
  isError?: boolean;
  content: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
}>;

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const cleanupPaths: string[] = [];

afterEach(async () => {
  for (const path of cleanupPaths.splice(0).reverse()) {
    await rm(path, { recursive: true, force: true });
  }
});

async function setup(bind = true) {
  const home = await mkdtemp(join(tmpdir(), 'figma-semantic-tool-home-'));
  const project = await mkdtemp(join(tmpdir(), 'figma-semantic-tool-project-'));
  cleanupPaths.push(home, project);
  const workspace = new SessionWorkspace({
    homeDirectory: home,
    sessionId: SESSION_ID,
    pluginRoots: [],
  });
  await workspace.initialize();
  if (bind) await workspace.bindRoot(project, SESSION_ID);
  const handlers = new Map<string, ToolHandler>();
  const server = {
    registerTool: (name: string, _definition: unknown, handler: ToolHandler) => {
      handlers.set(name, handler);
    },
  } as unknown as McpServer;
  const rpcResult = {
    rootNodeId: '84:681',
    rootNodeName: 'Sidebar',
    document: { name: 'Community' },
    page: { id: 'page:1', name: 'Home' },
    profile: 'OUTLINE',
    request: {
      focusNodeIds: [],
      includeRender: false,
      depth: 8,
      maxNodes: 200,
      maxTextLength: 500,
    },
    sourceFingerprint: '12345678abcdef00',
    nodeCount: 1,
    complete: true,
    truncation: null,
    outlineJsonl: '{"nodeId":"84:681"}\n',
    factsJsonl: '',
  };
  const broker = {
    connected: true,
    pluginVersion: '2.9.0',
    request: vi.fn(async (method: string) =>
      method === 'checkSemanticScope'
        ? {
            status: 'FRESH',
            rootNodeId: '84:681',
            storedFingerprint: '12345678abcdef00',
            currentFingerprint: '12345678abcdef00',
          }
        : rpcResult,
    ),
    onEvent: vi.fn(() => () => undefined),
    close: vi.fn(async () => undefined),
  } as unknown as BridgeTransport;
  registerSemanticTools(server, broker, new SemanticSnapshotStore(workspace));
  return { handlers, broker };
}

describe('语义快照 MCP 工具', () => {
  it('公开结果不包含 JSONL 正文', async () => {
    const { handlers } = await setup();
    const response = await handlers.get('figma_export_semantic_scope')!({
      rootNodeId: '84:681',
      profile: 'OUTLINE',
      expectedSessionId: SESSION_ID,
    });

    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toEqual({
      manifestPath: expect.stringContaining('.figma_bridge_agent/sessions/'),
      sourceFingerprint: '12345678abcdef00',
      complete: true,
    });
    expect(response.structuredContent).not.toHaveProperty('outlineJsonl');
    expect(response.content).toEqual([]);
  });

  it('会话不匹配时不请求插件', async () => {
    const { handlers, broker } = await setup();
    const response = await handlers.get('figma_export_semantic_scope')!({
      rootNodeId: '84:681',
      profile: 'OUTLINE',
      expectedSessionId: '22222222-2222-4222-8222-222222222222',
    });

    expect(response.isError).toBe(true);
    expect(response.content[0]?.text).toContain('EXPORT_SESSION_MISMATCH');
    expect(broker.request).not.toHaveBeenCalled();
  });

  it('未绑定工作区时不请求插件并返回 EXPORT_ROOT_UNBOUND', async () => {
    const { handlers, broker } = await setup(false);
    const response = await handlers.get('figma_export_semantic_scope')!({
      rootNodeId: '84:681',
      profile: 'OUTLINE',
      expectedSessionId: SESSION_ID,
    });

    expect(response.isError).toBe(true);
    expect(response.content[0]?.text).toContain('EXPORT_ROOT_UNBOUND');
    expect(broker.request).not.toHaveBeenCalled();
  });

  it('新鲜度检查只返回指纹状态', async () => {
    const { handlers } = await setup();
    const response = await handlers.get('figma_check_semantic_scope')!({
      rootNodeId: '84:681',
      storedFingerprint: '12345678abcdef00',
      expectedSessionId: SESSION_ID,
    });
    expect(response.structuredContent).toEqual({ status: 'FRESH' });
  });
});
