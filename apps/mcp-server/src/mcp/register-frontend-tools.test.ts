import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { McpServer } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BridgeTransport } from '../bridge/transport.js';
import { FrontendContextStore } from '../frontend/frontend-context-store.js';
import { SessionWorkspace } from '../storage/session-workspace.js';
import { registerFrontendTools } from './register-frontend-tools.js';

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
  const home = await mkdtemp(join(tmpdir(), 'figma-frontend-tool-home-'));
  const project = await mkdtemp(join(tmpdir(), 'figma-frontend-tool-project-'));
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
  const common = {
    rootNodeId: '84:681',
    rootNodeName: 'Sidebar',
    document: { name: 'Community' },
    page: { id: 'page:1', name: 'Home' },
    sourceFingerprint: '12345678abcdef00',
    nodeCount: 1,
    complete: true,
    truncation: null,
    outlineJsonl: '{"nodeId":"84:681"}\n',
  };
  const broker = {
    connected: true,
    pluginVersion: '3.0.0',
    request: vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === 'indexScope') return { ...common, request: params };
      if (method === 'prepareWorkunitSource') {
        return { ...common, request: params, factsJsonl: '{"nodeId":"84:681"}\n' };
      }
      return {
        status: 'FRESH',
        rootNodeId: '84:681',
        storedFingerprint: '12345678abcdef00',
        currentFingerprint: '12345678abcdef00',
      };
    }),
    onEvent: vi.fn(() => () => undefined),
    close: vi.fn(async () => undefined),
  } as unknown as BridgeTransport;
  registerFrontendTools(server, broker, new FrontendContextStore(workspace));
  return { handlers, broker };
}

describe('前端 workunit MCP 工具', () => {
  it('结构索引公开结果不包含 JSONL 正文', async () => {
    const { handlers } = await setup();
    const response = await handlers.get('figma_frontend_index_scope')!({
      rootNodeId: '84:681',
      expectedSessionId: SESSION_ID,
    });
    expect(response.structuredContent).toEqual({
      indexManifestPath: expect.stringContaining('.figma_bridge_agent/sessions/'),
      sourceFingerprint: '12345678abcdef00',
      structureComplete: true,
    });
    expect(response.structuredContent).not.toHaveProperty('outlineJsonl');
  });

  it('prepare 返回稳定 workunit 引用且不公开 facts', async () => {
    const { handlers } = await setup();
    const response = await handlers.get('figma_frontend_prepare_workunit')!({
      rootNodeId: '84:681',
      factNodeIds: ['84:681'],
      expectedSessionId: SESSION_ID,
    });
    expect(response.structuredContent).toMatchObject({
      workUnitId: expect.stringMatching(/^workunit-/),
      workUnitPath: expect.stringContaining('/work-units/'),
      sourceFingerprint: '12345678abcdef00',
      evidenceComplete: true,
      requiresMappingReview: false,
    });
    expect(response.structuredContent).not.toHaveProperty('factsJsonl');
  });

  it('会话不匹配和未绑定时都不会请求插件', async () => {
    const mismatch = await setup();
    const mismatchResponse = await mismatch.handlers.get('figma_frontend_prepare_workunit')!({
      rootNodeId: '84:681',
      expectedSessionId: '22222222-2222-4222-8222-222222222222',
    });
    expect(mismatchResponse.content[0]?.text).toContain('EXPORT_SESSION_MISMATCH');
    expect(mismatch.broker.request).not.toHaveBeenCalled();

    const unbound = await setup(false);
    const unboundResponse = await unbound.handlers.get('figma_frontend_index_scope')!({
      rootNodeId: '84:681',
      expectedSessionId: SESSION_ID,
    });
    expect(unboundResponse.content[0]?.text).toContain('EXPORT_ROOT_UNBOUND');
    expect(unbound.broker.request).not.toHaveBeenCalled();
  });

  it('新鲜度检查只接收 workUnitId 并使用实施指纹', async () => {
    const { handlers, broker } = await setup();
    const prepared = await handlers.get('figma_frontend_prepare_workunit')!({
      rootNodeId: '84:681',
      expectedSessionId: SESSION_ID,
    });
    const workUnitId = String(prepared.structuredContent?.workUnitId);
    const response = await handlers.get('figma_frontend_check_workunit_source')!({ workUnitId });
    expect(response.structuredContent).toEqual({ status: 'FRESH' });
    expect(broker.request).toHaveBeenLastCalledWith(
      'checkWorkunitSource',
      { rootNodeId: '84:681', storedFingerprint: '12345678abcdef00' },
      30_000,
    );
  });
});
