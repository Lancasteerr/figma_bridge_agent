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
const WORK_UNIT_ID = 'workunit-1234567890abcdef';
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const JPG_1X1 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EB//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EB//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EB//2Q==';

afterEach(async () => {
  for (const store of artifactStores.splice(0).reverse()) await store.close();
  for (const path of cleanupPaths.splice(0).reverse()) {
    await rm(path, { recursive: true, force: true });
  }
});

async function setup(
  rpcResult:
    | Record<string, unknown>
    | ((
        method: string,
        params: unknown,
      ) => Record<string, unknown> | Promise<Record<string, unknown>>),
  options: { bind?: boolean; delegateSourceGuard?: boolean } = {},
) {
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
    pluginVersion: '3.0.1',
    request: vi.fn(async (method: string, params: unknown) => {
      if (method === 'checkAssetSourceGuard' && !options.delegateSourceGuard) {
        return { rootNodeId: 'root', sourceFingerprint: 'source-123' };
      }
      return typeof rpcResult === 'function' ? await rpcResult(method, params) : rpcResult;
    }),
    onEvent: vi.fn(() => () => undefined),
    close: vi.fn(async () => undefined),
  } as unknown as BridgeTransport;
  registerMediaTools(server, broker, artifacts, exports, {
    resolveAssetSource: vi.fn(async () => ({
      rootNodeId: 'root',
      expectedSourceFingerprint: 'source-123',
    })),
  });
  if (options.bind !== false) {
    const response = await handlers.get('figma_frontend_bind_workspace')!({
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
    handler: (input: Record<string, unknown>) =>
      handlers.get('figma_frontend_export_assets')!({ workUnitId: WORK_UNIT_ID, ...input }),
  };
}

const rawSamples = {
  png: { bytes: Buffer.from(PNG_1X1, 'base64'), width: 1, height: 1 },
  jpg: { bytes: Buffer.from(JPG_1X1, 'base64'), width: 1, height: 1 },
  gif: {
    bytes: Buffer.from('47494638396101000100800000000000ffffff21f904', 'hex'),
    width: 1,
    height: 1,
  },
  webp: {
    bytes: Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64'),
    width: 1,
    height: 1,
  },
};

describe('figma_frontend_export_assets MCP 工具', () => {
  it.each(Object.entries(rawSamples))('识别 RAW %s 魔数和最终字节尺寸', async (ext, sample) => {
    const { bytes, width, height } = sample;
    const { handler, workspace } = await setup({
      nodeId: 'node:1',
      mode: 'RAW',
      format: 'ORIGINAL',
      mimeType: 'application/octet-stream',
      data: bytes.toString('base64'),
      encoding: 'base64',
      width: 1,
      height: 1,
    });

    const response = await handler({
      items: [
        {
          nodeId: 'node:1',
          mode: 'RAW',
          paintSlot: 'FILLS',
          paintIndex: 0,
          outputPathStem: 'src/assets/image',
        },
      ],
    });

    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toEqual({
      assets: [
        {
          status: 'CREATED',
          path: `src/assets/image.${ext}`,
          mimeType: ext === 'jpg' ? 'image/jpeg' : `image/${ext}`,
          intrinsicWidth: width,
          intrinsicHeight: height,
          dimensionUnit: 'PIXEL',
        },
      ],
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
      width: 1,
      height: 1,
    });
    const response = await handler({
      items: [
        {
          nodeId: 'node:1',
          mode: 'RAW',
          paintSlot: 'FILLS',
          paintIndex: 0,
          outputPathStem: 'assets/image',
        },
      ],
    });
    expect(response.isError).toBe(true);
    expect(response.content[0]?.text).toContain('UNSUPPORTED_ASSET_FORMAT');
  });

  it('RENDERED 格式与扩展名不符时不请求插件', async () => {
    const { handler, broker } = await setup({});
    const response = await handler({
      items: [
        {
          nodeId: 'node:1',
          mode: 'RENDERED',
          format: 'PNG',
          outputPath: 'assets/logo.svg',
        },
      ],
    });
    expect(response.isError).toBe(true);
    expect(broker.request).not.toHaveBeenCalled();
  });

  it('绑定工具不依赖 Figma RPC，且过期会话返回结构化错误', async () => {
    const { workspace, exports, broker, handlers } = await setup({}, { bind: false });
    const handler = handlers.get('figma_frontend_bind_workspace')!;

    const mismatch = await handler({
      rootPath: workspace,
      expectedSessionId: '22222222-2222-4222-8222-222222222222',
    });
    expect(mismatch.isError).toBe(true);
    expect(mismatch.content[0]?.text).toContain('EXPORT_SESSION_MISMATCH');

    const response = await handler({ rootPath: workspace, expectedSessionId: SESSION_ID });
    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toEqual({
      rootPath: await realpath(workspace),
    });
    expect(exports.status).toMatchObject({ state: 'BOUND', rootPath: await realpath(workspace) });
    expect(broker.request).not.toHaveBeenCalled();
  });

  it('未绑定时返回 EXPORT_ROOT_UNBOUND，且不请求插件或创建暂存文件', async () => {
    const { handlers, broker, workspace } = await setup(
      {
        nodeId: 'node:1',
        mode: 'RENDERED',
        format: 'SVG',
        mimeType: 'image/svg+xml',
        data: '<svg xmlns="http://www.w3.org/2000/svg" />',
        encoding: 'utf8',
        width: 100,
        height: 80,
      },
      { bind: false },
    );

    const response = await handlers.get('figma_frontend_export_assets')!({
      workUnitId: WORK_UNIT_ID,
      items: [
        {
          nodeId: 'node:1',
          mode: 'RENDERED',
          format: 'SVG',
          outputPath: 'public/logo.svg',
        },
      ],
    });
    expect(response.isError).toBe(true);
    expect(response.content[0]?.text).toContain('EXPORT_ROOT_UNBOUND');
    expect(broker.request).not.toHaveBeenCalled();
    await expect(readFile(join(workspace, 'public/logo.svg'))).rejects.toBeDefined();
  });

  it('忽略源节点逻辑尺寸并返回最终 JPG 与 SVG 的固有尺寸', async () => {
    const jpg = rawSamples.jpg.bytes;
    const { handler } = await setup(async (_method, params) => {
      const item = params as { nodeId: string; format: 'PNG' | 'JPG' | 'SVG' };
      if (item.format === 'SVG') {
        return {
          nodeId: item.nodeId,
          mode: 'RENDERED',
          format: 'SVG',
          mimeType: 'image/svg+xml',
          data: '<svg xmlns="http://www.w3.org/2000/svg" width="23" height="22" />',
          encoding: 'utf8',
          width: 18.75,
          height: 17.835,
        };
      }
      return {
        nodeId: item.nodeId,
        mode: 'RENDERED',
        format: 'JPG',
        mimeType: 'image/jpeg',
        data: jpg.toString('base64'),
        encoding: 'base64',
        width: 240,
        height: 120,
      };
    });

    const response = await handler({
      items: [
        {
          nodeId: 'bitmap',
          mode: 'RENDERED',
          format: 'JPG',
          outputPath: 'assets/photo.jpg',
        },
        {
          nodeId: 'vector',
          mode: 'RENDERED',
          format: 'SVG',
          outputPath: 'assets/logo.svg',
        },
      ],
    });

    expect(response.structuredContent).toEqual({
      assets: [
        expect.objectContaining({
          mimeType: 'image/jpeg',
          intrinsicWidth: 1,
          intrinsicHeight: 1,
          dimensionUnit: 'PIXEL',
        }),
        expect.objectContaining({
          mimeType: 'image/svg+xml',
          intrinsicWidth: 23,
          intrinsicHeight: 22,
          dimensionUnit: 'FIGMA_UNIT',
        }),
      ],
    });
  });

  it.each([
    ['px 属性', '<svg xmlns="http://www.w3.org/2000/svg" width="23px" height="22px" />'],
    ['viewBox 回退', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 23 22" />'],
  ])('解析 SVG %s 的固有尺寸', async (_label, data) => {
    const { handler } = await setup({
      nodeId: 'vector',
      mode: 'RENDERED',
      format: 'SVG',
      mimeType: 'image/svg+xml',
      data,
      encoding: 'utf8',
      width: 18.75,
      height: 17.835,
    });

    const response = await handler({
      items: [
        {
          nodeId: 'vector',
          mode: 'RENDERED',
          format: 'SVG',
          outputPath: 'assets/vector.svg',
        },
      ],
    });
    expect(response.structuredContent).toMatchObject({
      assets: [{ intrinsicWidth: 23, intrinsicHeight: 22, dimensionUnit: 'FIGMA_UNIT' }],
    });
  });

  it('SVG 缺少有效尺寸时整批失败且不写入已验证项目', async () => {
    const png = rawSamples.png.bytes;
    const { handler, workspace } = await setup(async (_method, params) => {
      const item = params as { nodeId: string };
      if (item.nodeId === 'bitmap') {
        return {
          nodeId: item.nodeId,
          mode: 'RENDERED',
          format: 'PNG',
          mimeType: 'image/png',
          data: png.toString('base64'),
          encoding: 'base64',
          width: 100,
          height: 100,
        };
      }
      return {
        nodeId: item.nodeId,
        mode: 'RENDERED',
        format: 'SVG',
        mimeType: 'image/svg+xml',
        data: '<svg xmlns="http://www.w3.org/2000/svg" />',
        encoding: 'utf8',
        width: 100,
        height: 80,
      };
    });

    const response = await handler({
      items: [
        { nodeId: 'bitmap', mode: 'RENDERED', format: 'PNG', outputPath: 'assets/ok.png' },
        { nodeId: 'vector', mode: 'RENDERED', format: 'SVG', outputPath: 'assets/bad.svg' },
      ],
    });
    expect(response.isError).toBe(true);
    expect(response.content[0]?.text).toContain('UNSUPPORTED_ASSET_FORMAT');
    await expect(readFile(join(workspace, 'assets/ok.png'))).rejects.toBeDefined();
    await expect(readFile(join(workspace, 'assets/bad.svg'))).rejects.toBeDefined();
  });

  it('source guard 在整批前后复检，变化时不提交任何文件', async () => {
    let guardChecks = 0;
    const { handler, workspace, broker } = await setup(
      async (method) => {
        if (method === 'checkAssetSourceGuard') {
          guardChecks += 1;
          return {
            rootNodeId: 'root',
            sourceFingerprint: guardChecks === 1 ? 'source-123' : 'source-changed',
          };
        }
        return {
          nodeId: 'node:1',
          mode: 'RENDERED',
          format: 'SVG',
          mimeType: 'image/svg+xml',
          data: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80" />',
          encoding: 'utf8',
          width: 100,
          height: 80,
        };
      },
      { delegateSourceGuard: true },
    );

    const response = await handler({
      items: [
        {
          nodeId: 'node:1',
          mode: 'RENDERED',
          format: 'SVG',
          outputPath: 'assets/logo.svg',
        },
      ],
    });

    expect(response.isError).toBe(true);
    expect(response.content[0]?.text).toContain('ASSET_SOURCE_CHANGED');
    expect(broker.request).toHaveBeenNthCalledWith(
      1,
      'checkAssetSourceGuard',
      { rootNodeId: 'root', nodeIds: ['node:1'] },
      60_000,
    );
    await expect(readFile(join(workspace, 'assets/logo.svg'))).rejects.toBeDefined();
  });

  it('解析后路径重复时整批失败且不产生部分文件', async () => {
    const bytes = rawSamples.png.bytes;
    const { handler, workspace } = await setup({
      nodeId: 'node:1',
      mode: 'RAW',
      format: 'ORIGINAL',
      mimeType: 'application/octet-stream',
      data: bytes.toString('base64'),
      encoding: 'base64',
      width: 1,
      height: 1,
    });

    const response = await handler({
      items: [0, 1].map((paintIndex) => ({
        nodeId: 'node:1',
        mode: 'RAW',
        paintSlot: 'FILLS',
        paintIndex,
        outputPathStem: 'assets/same',
      })),
    });

    expect(response.isError).toBe(true);
    expect(response.content[0]?.text).toContain('EXPORT_PATH_INVALID');
    await expect(readFile(join(workspace, 'assets/same.png'))).rejects.toBeDefined();
  });

  it('总暂存数据超过 64 MiB 时拒绝整批', async () => {
    const bytes = Buffer.alloc(8 * 1024 * 1024 + 1);
    rawSamples.png.bytes.copy(bytes);
    const payload = bytes.toString('base64');
    const { handler, workspace } = await setup({
      nodeId: 'node:1',
      mode: 'RAW',
      format: 'ORIGINAL',
      mimeType: 'application/octet-stream',
      data: payload,
      encoding: 'base64',
      width: 1,
      height: 1,
    });

    const response = await handler({
      items: Array.from({ length: 8 }, (_, index) => ({
        nodeId: `node:${index}`,
        mode: 'RAW',
        paintSlot: 'FILLS',
        paintIndex: 0,
        outputPathStem: `assets/image-${index}`,
      })),
    });

    expect(response.isError).toBe(true);
    expect(response.content[0]?.text).toContain('PAYLOAD_TOO_LARGE');
    await expect(readFile(join(workspace, 'assets/image-0.png'))).rejects.toBeDefined();
  });
});

describe('figma_design_stage_asset MCP 工具', () => {
  it('公开结果只返回 assetId、尺寸和过期时间，摘要仅留在内部 RPC', async () => {
    const expiresAt = '2026-10-14T00:10:00.000Z';
    const { handlers, broker } = await setup(
      {
        assetId: '22222222-2222-4222-8222-222222222222',
        width: 1,
        height: 1,
        expiresAt,
      },
      { bind: false },
    );

    const response = await handlers.get('figma_design_stage_asset')!({
      name: 'pixel.png',
      mimeType: 'image/png',
      dataBase64: PNG_1X1,
    });

    expect(response.structuredContent).toEqual({
      assetId: '22222222-2222-4222-8222-222222222222',
      width: 1,
      height: 1,
      expiresAt,
    });
    expect(broker.request).toHaveBeenCalledWith(
      'stageAsset',
      expect.objectContaining({ sha256: expect.stringMatching(/^[a-f0-9]{64}$/), bytes: 68 }),
      30_000,
    );
  });
});

describe('figma_inspect_render_preview MCP 工具', () => {
  it('只返回临时 PNG 元数据，不回填 base64 或 image 内容块', async () => {
    const bytes = rawSamples.png.bytes;
    const { artifactRoot, handlers } = await setup(
      {
        nodeId: 'node:1',
        mimeType: 'image/png',
        data: bytes.toString('base64'),
        width: 100,
        height: 80,
        fingerprint: 'node-fingerprint',
      },
      { bind: false },
    );

    const response = await handlers.get('figma_inspect_render_preview')!({ nodeId: 'node:1' });

    expect(response.content).toEqual([]);
    expect(response.structuredContent).toMatchObject({
      localPath: expect.any(String),
      pixelWidth: 1,
      pixelHeight: 1,
      expiresAt: expect.any(String),
    });
    expect(response.structuredContent).not.toHaveProperty('data');
    expect(response.structuredContent).not.toHaveProperty('sha256');
    expect(response.structuredContent).not.toHaveProperty('bytes');
    expect(JSON.stringify(response)).not.toContain(bytes.toString('base64'));
    const localPath = response.structuredContent?.localPath;
    expect(typeof localPath).toBe('string');
    expect(String(localPath).startsWith(`${artifactRoot}${sep}`)).toBe(true);
    await expect(readFile(String(localPath))).resolves.toEqual(bytes);
  });
});
