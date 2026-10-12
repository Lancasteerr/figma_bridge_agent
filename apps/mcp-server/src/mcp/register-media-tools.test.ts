import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

import type { McpServer } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BridgeTransport } from '../bridge/transport.js';
import { ExportStore } from '../export/export-store.js';
import { TemporaryArtifactStore } from '../temp/artifact-store.js';
import { registerMediaTools } from './register-media-tools.js';

type ToolHandler = (input: Record<string, unknown>) => Promise<{
  isError?: boolean;
  content: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
}>;

const cleanupPaths: string[] = [];
const artifactStores: TemporaryArtifactStore[] = [];
const SESSION_ID = '11111111-1111-4111-8111-111111111111';

afterEach(async () => {
  for (const store of artifactStores.splice(0).reverse()) await store.close();
  for (const path of cleanupPaths.splice(0).reverse()) {
    await rm(path, { recursive: true, force: true });
  }
});

async function setup(rpcResult: Record<string, unknown>, options: { bind?: boolean } = {}) {
  const workspace = await mkdtemp(join(tmpdir(), 'figma-media-tool-workspace-test-'));
  const home = await mkdtemp(join(tmpdir(), 'figma-media-tool-home-test-'));
  cleanupPaths.push(workspace, home);
  const exports = new ExportStore({ homeDirectory: home, sessionId: SESSION_ID, pluginRoots: [] });
  await exports.initialize();
  const artifacts = new TemporaryArtifactStore({
    sessionId: SESSION_ID,
    baseDirectory: join(home, 'temporary-artifacts'),
  });
  await artifacts.initialize();
  artifactStores.push(artifacts);
  const handlers = new Map<string, ToolHandler>();
  const server = {
    registerTool: (name: string, _definition: unknown, handler: ToolHandler) => {
      handlers.set(name, handler);
    },
  } as unknown as McpServer;
  const broker = {
    connected: true,
    pluginVersion: '2.2.5',
    request: vi.fn(async () => rpcResult),
    onEvent: vi.fn(() => () => undefined),
    close: vi.fn(async () => undefined),
  } as unknown as BridgeTransport;
  registerMediaTools(server, broker, artifacts, exports);
  if (options.bind !== false) {
    const response = await handlers.get('figma_bind_export_root')!({
      rootPath: workspace,
      expectedSessionId: SESSION_ID,
    });
    if (response.isError) throw new Error(response.content[0]?.text ?? 'Binding failed.');
  }
  return {
    workspace,
    artifactRoot: artifacts.root,
    exports,
    broker,
    handlers,
    handler: handlers.get('figma_export_asset')!,
  };
}

const rawSamples = {
  png: Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex'),
  jpg: Buffer.from('ffd8ffe000104a46494600010100000100010000ffdb', 'hex'),
  gif: Buffer.from('47494638396101000100800000000000ffffff21f904', 'hex'),
  webp: Buffer.from('52494646140000005745425056503820080000001000009d012a', 'hex'),
};

describe('figma_export_asset MCP 工具', () => {
  it.each(Object.entries(rawSamples))('识别 RAW %s 魔数并追加真实扩展名', async (ext, bytes) => {
    const { handler, workspace } = await setup({
      nodeId: 'node:1',
      mode: 'RAW',
      format: 'ORIGINAL',
      mimeType: 'application/octet-stream',
      data: bytes.toString('base64'),
      encoding: 'base64',
      width: 1,
      height: 1,
      source: { imageHash: 'image-hash', nodeFingerprint: 'node-fingerprint' },
    });

    const response = await handler({
      nodeId: 'node:1',
      mode: 'RAW',
      paintSlot: 'FILLS',
      paintIndex: 0,
      expectedImageHash: 'image-hash',
      expectedNodeFingerprint: 'node-fingerprint',
      outputPathStem: 'src/assets/image',
    });

    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toMatchObject({
      status: 'CREATED',
      delivery: 'WORKSPACE',
      projectRelativePath: `src/assets/image.${ext}`,
      requiresCopy: false,
    });
    expect(response.structuredContent).not.toHaveProperty('data');
    await expect(readFile(join(workspace, `src/assets/image.${ext}`))).resolves.toEqual(bytes);
  });

  it('拒绝不支持的 RAW 编码且不落盘', async () => {
    const { handler } = await setup({
      nodeId: 'node:1',
      mode: 'RAW',
      format: 'ORIGINAL',
      mimeType: 'application/octet-stream',
      data: Buffer.from('not-an-image').toString('base64'),
      encoding: 'base64',
      source: { imageHash: 'image-hash', nodeFingerprint: 'node-fingerprint' },
    });
    const response = await handler({
      nodeId: 'node:1',
      mode: 'RAW',
      paintSlot: 'FILLS',
      paintIndex: 0,
      expectedImageHash: 'image-hash',
      expectedNodeFingerprint: 'node-fingerprint',
      outputPathStem: 'assets/image',
    });
    expect(response.isError).toBe(true);
    expect(response.content[0]?.text).toContain('UNSUPPORTED_ASSET_FORMAT');
  });

  it('RENDERED 格式与扩展名不符时不请求插件', async () => {
    const { handler, broker } = await setup({});
    const response = await handler({
      nodeId: 'node:1',
      mode: 'RENDERED',
      format: 'PNG',
      expectedTreeFingerprint: 'tree-fingerprint',
      outputPath: 'assets/logo.svg',
    });
    expect(response.isError).toBe(true);
    expect(broker.request).not.toHaveBeenCalled();
  });

  it('绑定工具不依赖 Figma RPC，且过期会话返回结构化错误', async () => {
    const { workspace, exports, broker, handlers } = await setup({}, { bind: false });
    const handler = handlers.get('figma_bind_export_root')!;

    const mismatch = await handler({
      rootPath: workspace,
      expectedSessionId: '22222222-2222-4222-8222-222222222222',
    });
    expect(mismatch.isError).toBe(true);
    expect(mismatch.content[0]?.text).toContain('EXPORT_SESSION_MISMATCH');

    const response = await handler({ rootPath: workspace, expectedSessionId: SESSION_ID });
    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toEqual({
      delivery: 'WORKSPACE',
      rootPath: await realpath(workspace),
      sessionId: SESSION_ID,
    });
    expect(exports.status.delivery).toBe('WORKSPACE');
    expect(broker.request).not.toHaveBeenCalled();
  });

  it('STAGED 返回 requiresCopy 与工程相对路径，且不泄漏正文', async () => {
    const { handlers } = await setup(
      {
        nodeId: 'node:1',
        mode: 'RENDERED',
        format: 'SVG',
        mimeType: 'image/svg+xml',
        data: '<svg xmlns="http://www.w3.org/2000/svg" />',
        encoding: 'utf8',
        source: { treeFingerprint: 'tree-fingerprint' },
      },
      { bind: false },
    );

    const response = await handlers.get('figma_export_asset')!({
      nodeId: 'node:1',
      mode: 'RENDERED',
      format: 'SVG',
      expectedTreeFingerprint: 'tree-fingerprint',
      outputPath: 'public/logo.svg',
    });
    expect(response.structuredContent).toMatchObject({
      delivery: 'STAGED',
      projectRelativePath: 'public/logo.svg',
      requiresCopy: true,
    });
    expect(response.structuredContent).not.toHaveProperty('data');
    expect(response.content).toEqual([]);
  });
});

describe('figma_render_node MCP 工具', () => {
  it('只返回临时 PNG 元数据，不回填 base64 或 image 内容块', async () => {
    const bytes = rawSamples.png;
    const { artifactRoot, handlers } = await setup({
      nodeId: 'node:1',
      mimeType: 'image/png',
      data: bytes.toString('base64'),
      width: 100,
      height: 80,
      fingerprint: 'node-fingerprint',
    });

    const response = await handlers.get('figma_render_node')!({ nodeId: 'node:1' });

    expect(response.content).toEqual([]);
    expect(response.structuredContent).toMatchObject({
      nodeId: 'node:1',
      mimeType: 'image/png',
      width: 100,
      height: 80,
      bytes: bytes.byteLength,
    });
    expect(response.structuredContent).not.toHaveProperty('data');
    expect(JSON.stringify(response)).not.toContain(bytes.toString('base64'));
    const localPath = response.structuredContent?.localPath;
    expect(typeof localPath).toBe('string');
    expect(String(localPath).startsWith(`${artifactRoot}${sep}`)).toBe(true);
    await expect(readFile(String(localPath))).resolves.toEqual(bytes);
  });
});
