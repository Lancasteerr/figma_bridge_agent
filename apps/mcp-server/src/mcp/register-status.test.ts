import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { McpServer } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BridgeTransport } from '../bridge/transport.js';
import { ExportStore } from '../export/export-store.js';
import { registerStatusTool } from './register-status.js';

type ToolHandler = () => Promise<{
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

async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'figma-status-home-'));
  cleanupPaths.push(home);
  const exports = new ExportStore({ homeDirectory: home, sessionId: SESSION_ID, pluginRoots: [] });
  await exports.initialize();
  let handler: ToolHandler | undefined;
  const server = {
    registerTool: (_name: string, _definition: unknown, registered: ToolHandler) => {
      handler = registered;
    },
  } as unknown as McpServer;
  const broker = {
    request: vi.fn(async () => ({
      connected: true,
      authenticated: true,
      protocolVersion: 10,
      pluginVersion: '3.0.1',
      document: { id: 'document:1', name: 'Community' },
      page: { id: 'page:1', name: 'Home' },
      selection: [{ id: 'node:1', name: 'Hero', type: 'FRAME', parentId: 'page:1' }],
      capabilities: ['read'],
    })),
  } as unknown as BridgeTransport;
  registerStatusTool(server, broker, exports);
  return { exports, handler: handler!, home };
}

describe('figma_status 工作区边界', () => {
  it('只公开设计上下文和 UNBOUND 会话状态', async () => {
    const { handler } = await setup();

    const response = await handler();

    expect(response.structuredContent).toEqual({
      document: { name: 'Community' },
      page: { id: 'page:1', name: 'Home' },
      selection: [{ id: 'node:1', name: 'Hero', type: 'FRAME', parentId: 'page:1' }],
      workspace: { state: 'UNBOUND', sessionId: SESSION_ID },
    });
  });

  it('绑定后只增加规范化根路径，不恢复连接诊断字段', async () => {
    const { exports, handler } = await setup();
    const project = await mkdtemp(join(tmpdir(), 'figma-status-project-'));
    cleanupPaths.push(project);
    await exports.bindRoot(project, SESSION_ID);

    const response = await handler();

    expect(response.structuredContent?.workspace).toEqual({
      state: 'BOUND',
      sessionId: SESSION_ID,
      rootPath: await realpath(project),
    });
    expect(response.structuredContent).not.toHaveProperty('connected');
    expect(response.structuredContent).not.toHaveProperty('capabilities');
  });
});
