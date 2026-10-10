import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { McpServer } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BridgeTransport } from '../bridge/transport.js';
import { ExportStore } from '../export/export-store.js';
import type { TempAssetStore } from '../temp/asset-store.js';
import { registerMediaTools } from './register-media-tools.js';

type ToolHandler = (input: Record<string, unknown>) => Promise<{
  isError?: boolean;
  content: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
}>;

const cleanupPaths: string[] = [];

afterEach(async () => {
  for (const path of cleanupPaths.splice(0).reverse()) {
    await rm(path, { recursive: true, force: true });
  }
});

async function setup(rpcResult: Record<string, unknown>) {
  const cwd = await mkdtemp(join(tmpdir(), 'figma-media-tool-test-'));
  cleanupPaths.push(cwd);
  const exports = new ExportStore({ cwd, homeDirectory: cwd });
  await exports.initialize();
  const handlers = new Map<string, ToolHandler>();
  const server = {
    registerTool: (name: string, _definition: unknown, handler: ToolHandler) => {
      handlers.set(name, handler);
    },
  } as unknown as McpServer;
  const broker = {
    connected: true,
    pluginVersion: '2.0.0',
    request: vi.fn(async () => rpcResult),
    onEvent: vi.fn(() => () => undefined),
    close: vi.fn(async () => undefined),
  } as unknown as BridgeTransport;
  registerMediaTools(server, broker, {} as TempAssetStore, exports);
  return { cwd, exports, broker, handler: handlers.get('figma_export_asset')! };
}

const rawSamples = {
  png: Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex'),
  jpg: Buffer.from('ffd8ffe000104a46494600010100000100010000ffdb', 'hex'),
  gif: Buffer.from('47494638396101000100800000000000ffffff21f904', 'hex'),
  webp: Buffer.from('52494646140000005745425056503820080000001000009d012a', 'hex'),
};

describe('figma_export_asset MCP 工具', () => {
  it.each(Object.entries(rawSamples))('识别 RAW %s 魔数并追加真实扩展名', async (ext, bytes) => {
    const { handler, cwd } = await setup({
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
    await expect(readFile(join(cwd, `src/assets/image.${ext}`))).resolves.toEqual(bytes);
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

  it('STAGED 返回 requiresCopy 与工程相对路径，且不泄漏正文', async () => {
    const home = await mkdtemp(join(tmpdir(), 'figma-media-stage-test-'));
    cleanupPaths.push(home);
    const exports = new ExportStore({ cwd: null, homeDirectory: home });
    await exports.initialize();
    const handlers = new Map<string, ToolHandler>();
    const server = {
      registerTool: (name: string, _definition: unknown, handler: ToolHandler) => {
        handlers.set(name, handler);
      },
    } as unknown as McpServer;
    const broker = {
      connected: true,
      pluginVersion: '2.0.0',
      request: vi.fn(async () => ({
        nodeId: 'node:1',
        mode: 'RENDERED',
        format: 'SVG',
        mimeType: 'image/svg+xml',
        data: '<svg xmlns="http://www.w3.org/2000/svg" />',
        encoding: 'utf8',
        source: { treeFingerprint: 'tree-fingerprint' },
      })),
      onEvent: vi.fn(() => () => undefined),
      close: vi.fn(async () => undefined),
    } as unknown as BridgeTransport;
    registerMediaTools(server, broker, {} as TempAssetStore, exports);

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
    expect(response.content[0]?.text).not.toContain('<svg');
  });
});
