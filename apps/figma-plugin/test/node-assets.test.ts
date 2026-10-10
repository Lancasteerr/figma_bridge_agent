import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSerializeContext, serializeNode } from '../src/main/serialization/node-snapshot.js';

const page = { id: 'page:1', name: 'Page', type: 'PAGE', parent: null } as unknown as PageNode;

function makeNode(overrides: Record<string, unknown> = {}): SceneNode {
  return {
    id: 'node:1',
    name: 'Asset',
    type: 'VECTOR',
    parent: page,
    x: 0,
    y: 0,
    width: 100,
    height: 80,
    rotation: 0,
    absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 80 },
    fills: [],
    strokes: [],
    exportSettings: [],
    vectorPaths: [],
    vectorNetwork: { vertices: [], segments: [] },
    isMask: false,
    maskType: 'ALPHA',
    ...overrides,
  } as unknown as SceneNode;
}

afterEach(() => vi.unstubAllGlobals());

describe('节点素材快照', () => {
  it('序列化图片 paint、导出设置、矢量和蒙版事实', async () => {
    vi.stubGlobal('figma', {
      getImageByHash: vi.fn(() => ({
        getSizeAsync: vi.fn(async () => ({ width: 640, height: 480 })),
      })),
    });
    const node = makeNode({
      fills: [
        {
          type: 'IMAGE',
          imageHash: 'image-hash',
          scaleMode: 'CROP',
          imageTransform: [
            [1, 0, 0.25],
            [0, 1, 0.5],
          ],
          filters: { contrast: 0.2 },
          opacity: 0.8,
          blendMode: 'MULTIPLY',
          visible: false,
        },
      ],
      exportSettings: [
        {
          format: 'PNG',
          suffix: '@2x',
          constraint: { type: 'SCALE', value: 2 },
          contentsOnly: true,
          useAbsoluteBounds: false,
        },
      ],
      vectorPaths: [{ data: 'M0 0', windingRule: 'NONZERO' }],
      vectorNetwork: { vertices: [], segments: [{ start: 0, end: 1 }] },
      isMask: true,
      maskType: 'LUMINANCE',
    });

    const snapshot = await serializeNode(node);
    expect(snapshot.assets).toMatchObject({
      imagePaints: [
        {
          paintSlot: 'FILLS',
          paintIndex: 0,
          imageHash: 'image-hash',
          imageSize: { width: 640, height: 480 },
          scaleMode: 'CROP',
          visible: false,
        },
      ],
      exportSettings: [{ format: 'PNG', suffix: '@2x' }],
      vector: { pathCount: 1, segmentCount: 1 },
      mask: { isMask: true, maskType: 'LUMINANCE' },
    });
  });

  it('在同一读取上下文中只查询一次相同 imageHash', async () => {
    const getSizeAsync = vi.fn(async () => ({ width: 32, height: 32 }));
    const getImageByHash = vi.fn(() => ({ getSizeAsync }));
    vi.stubGlobal('figma', { getImageByHash });
    const imagePaint = { type: 'IMAGE', imageHash: 'shared', scaleMode: 'FILL' };
    const context = createSerializeContext();

    await serializeNode(makeNode({ id: 'node:1', fills: [imagePaint] }), {}, context);
    await serializeNode(makeNode({ id: 'node:2', strokes: [imagePaint] }), {}, context);

    expect(getImageByHash).toHaveBeenCalledTimes(1);
    expect(getSizeAsync).toHaveBeenCalledTimes(1);
  });

  it('保留空 hash 和图片尺寸查询错误，不中断节点读取', async () => {
    vi.stubGlobal('figma', {
      mixed: Symbol('mixed'),
      getImageByHash: vi.fn(() => ({
        getSizeAsync: vi.fn(async () => Promise.reject(new Error('failed'))),
      })),
    });
    const snapshot = await serializeNode(
      makeNode({
        fills: [
          { type: 'IMAGE', imageHash: null, scaleMode: 'FIT' },
          { type: 'IMAGE', imageHash: 'broken', scaleMode: 'TILE' },
        ],
        strokes: Symbol('mixed'),
      }),
    );

    expect(snapshot.assets?.imagePaints).toMatchObject([
      { imageHash: '', imageSizeUnavailable: true, imageSizeError: 'EMPTY_IMAGE_HASH' },
      { imageHash: 'broken', imageSizeUnavailable: true, imageSizeError: 'QUERY_FAILED' },
    ]);
  });

  it('素材裁剪事实变化会改变节点指纹', async () => {
    vi.stubGlobal('figma', {
      getImageByHash: vi.fn(() => ({
        getSizeAsync: vi.fn(async () => ({ width: 10, height: 10 })),
      })),
    });
    const first = await serializeNode(
      makeNode({ fills: [{ type: 'IMAGE', imageHash: 'hash', scaleMode: 'CROP', rotation: 0 }] }),
    );
    const second = await serializeNode(
      makeNode({ fills: [{ type: 'IMAGE', imageHash: 'hash', scaleMode: 'CROP', rotation: 90 }] }),
    );

    expect(first.fingerprint).not.toBe(second.fingerprint);
  });
});
