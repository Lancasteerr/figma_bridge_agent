import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  serializeNode: vi.fn(),
  fingerprintNodeTree: vi.fn(),
}));

vi.mock('../src/main/serialization/node-snapshot.js', () => mocks);

import { checkAssetSourceGuard, exportAsset } from '../src/main/handlers/render.js';

const page = { id: 'page:1', name: 'Page', type: 'PAGE', parent: null };

function stubFigma(node: Record<string, unknown>, image?: Record<string, unknown>) {
  vi.stubGlobal('figma', {
    currentPage: page,
    getNodeByIdAsync: vi.fn(async () => node),
    getImageByHash: vi.fn(() => image ?? null),
    base64Encode: vi.fn((bytes: Uint8Array) => Buffer.from(bytes).toString('base64')),
  });
}

function makeNode(overrides: Record<string, unknown> = {}) {
  return {
    id: 'node:1',
    name: 'Asset',
    type: 'RECTANGLE',
    parent: page,
    x: 0,
    y: 0,
    width: 100,
    height: 80,
    fills: [{ type: 'IMAGE', imageHash: 'raw-hash', scaleMode: 'FILL' }],
    strokes: [],
    exportAsync: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.serializeNode.mockResolvedValue({ fingerprint: 'node-fingerprint' });
  mocks.fingerprintNodeTree.mockResolvedValue('tree-fingerprint');
});
afterEach(() => vi.unstubAllGlobals());

describe('Figma 素材导出', () => {
  it('RAW 精确选择 paint 并返回未经转换的原始字节', async () => {
    const bytes = Uint8Array.from([1, 2, 3]);
    const image = {
      getBytesAsync: vi.fn(async () => bytes),
      getSizeAsync: vi.fn(async () => ({ width: 20, height: 10 })),
    };
    const node = makeNode({
      strokes: [
        { type: 'SOLID', color: { r: 0, g: 0, b: 0 } },
        { type: 'IMAGE', imageHash: 'raw-hash', scaleMode: 'CROP' },
      ],
    });
    stubFigma(node, image);

    await expect(
      exportAsset({
        nodeId: node.id,
        mode: 'RAW',
        paintSlot: 'STROKES',
        paintIndex: 1,
      }),
    ).resolves.toMatchObject({
      mode: 'RAW',
      format: 'ORIGINAL',
      data: Buffer.from(bytes).toString('base64'),
      width: 20,
      height: 10,
    });
    expect(image.getBytesAsync).toHaveBeenCalledOnce();
    expect(node.exportAsync).not.toHaveBeenCalled();
  });

  it('RAW 导出期间节点或 image hash 变化时拒绝结果', async () => {
    const getBytesAsync = vi.fn(async () => Uint8Array.from([1]));
    const node = makeNode();
    stubFigma(node, {
      getBytesAsync,
      getSizeAsync: vi.fn(async () => ({ width: 1, height: 1 })),
    });
    mocks.serializeNode
      .mockResolvedValueOnce({ fingerprint: 'before' })
      .mockResolvedValueOnce({ fingerprint: 'after' });

    await expect(
      exportAsset({
        nodeId: node.id,
        mode: 'RAW',
        paintSlot: 'FILLS',
        paintIndex: 0,
      }),
    ).rejects.toMatchObject({ bridgeError: { code: 'ASSET_SOURCE_CHANGED' } });
    expect(getBytesAsync).toHaveBeenCalledOnce();
  });

  it('RENDERED 导出期间子树变化时拒绝结果', async () => {
    const node = makeNode({ exportAsync: vi.fn(async () => Uint8Array.from([1])) });
    stubFigma(node);
    mocks.fingerprintNodeTree.mockResolvedValueOnce('before').mockResolvedValueOnce('after');

    await expect(
      exportAsset({
        nodeId: node.id,
        mode: 'RENDERED',
        format: 'PNG',
        scale: 2,
      }),
    ).rejects.toMatchObject({ bridgeError: { code: 'ASSET_SOURCE_CHANGED' } });
    expect(node.exportAsync).toHaveBeenCalledOnce();
  });

  it.each([
    ['PNG', { format: 'PNG', constraint: { type: 'SCALE', value: 2 } }],
    ['JPG', { format: 'JPG', constraint: { type: 'SCALE', value: 2 } }],
  ] as const)('以 %s 和 SCALE 约束渲染位图', async (format, expectedCall) => {
    const node = makeNode({ exportAsync: vi.fn(async () => Uint8Array.from([1])) });
    stubFigma(node);

    const result = await exportAsset({
      nodeId: node.id,
      mode: 'RENDERED',
      format,
      scale: 2,
    });

    expect(node.exportAsync).toHaveBeenCalledWith(expectedCall);
    expect(result).toMatchObject({ format, width: 200, height: 160 });
  });

  it('以 SVG_STRING 渲染 SVG 且不接受 scale', async () => {
    const node = makeNode({ exportAsync: vi.fn(async () => '<svg />') });
    stubFigma(node);

    await expect(
      exportAsset({
        nodeId: node.id,
        mode: 'RENDERED',
        format: 'SVG',
      }),
    ).resolves.toMatchObject({
      format: 'SVG',
      encoding: 'utf8',
      width: 100,
      height: 80,
    });
    expect(node.exportAsync).toHaveBeenCalledWith({ format: 'SVG_STRING' });
  });

  it('拒绝超过 9 MiB 的单项载荷', async () => {
    const node = makeNode({
      exportAsync: vi.fn(async () => new Uint8Array(9 * 1024 * 1024 + 1)),
    });
    stubFigma(node);

    await expect(
      exportAsset({
        nodeId: node.id,
        mode: 'RENDERED',
        format: 'PNG',
      }),
    ).rejects.toMatchObject({ bridgeError: { code: 'PAYLOAD_TOO_LARGE' } });
  });

  it('source guard 校验根指纹并拒绝根外节点', async () => {
    const root = makeNode({ id: 'root', parent: page });
    const child = makeNode({ id: 'child', parent: root });
    const outside = makeNode({ id: 'outside', parent: page });
    vi.stubGlobal('figma', {
      currentPage: page,
      getNodeByIdAsync: vi.fn(
        async (id: string) => ({ root, child, outside })[id as 'root' | 'child' | 'outside'],
      ),
    });

    await expect(
      checkAssetSourceGuard({ rootNodeId: 'root', nodeIds: ['child'] }),
    ).resolves.toEqual({ rootNodeId: 'root', sourceFingerprint: 'tree-fingerprint' });
    await expect(
      checkAssetSourceGuard({ rootNodeId: 'root', nodeIds: ['outside'] }),
    ).rejects.toMatchObject({ bridgeError: { code: 'NODE_NOT_IN_CURRENT_PAGE' } });
  });
});
