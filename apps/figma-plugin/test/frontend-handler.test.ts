import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fingerprintNodeTree: vi.fn(),
  serializeWorkunitSource: vi.fn(),
}));

vi.mock('../src/main/serialization/node-snapshot.js', () => ({
  fingerprintNodeTree: mocks.fingerprintNodeTree,
}));
vi.mock('../src/main/serialization/scope-source.js', () => ({
  serializeScopeIndex: vi.fn(),
  serializeWorkunitSource: mocks.serializeWorkunitSource,
}));

import { prepareWorkunitSource } from '../src/main/handlers/frontend.js';

const page = { id: 'page:1', name: 'Page', type: 'PAGE', parent: null };
const root = {
  id: 'root',
  name: 'Root',
  type: 'FRAME',
  parent: page,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('figma', {
    root: { name: 'Document' },
    currentPage: page,
    getNodeByIdAsync: vi.fn(async () => root),
  });
  mocks.serializeWorkunitSource.mockResolvedValue({
    nodeCount: 1,
    complete: true,
    truncation: null,
    outlineJsonl: '{"nodeId":"root"}\n',
    factsJsonl: '{"nodeId":"root"}\n',
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('workunit 来源 handler', () => {
  it('生成期间完整树变化时拒绝返回正文', async () => {
    mocks.fingerprintNodeTree
      .mockResolvedValueOnce('before-123')
      .mockResolvedValueOnce('after-456');
    await expect(prepareWorkunitSource({ rootNodeId: 'root' })).rejects.toMatchObject({
      bridgeError: { code: 'WORKUNIT_SOURCE_CHANGED', nodeId: 'root' },
    });
  });

  it('实施正文超过 12 MiB 时要求拆分事实节点', async () => {
    mocks.fingerprintNodeTree.mockResolvedValue('stable-123');
    mocks.serializeWorkunitSource.mockResolvedValue({
      nodeCount: 1,
      complete: true,
      truncation: null,
      outlineJsonl: 'x'.repeat(12 * 1024 * 1024),
      factsJsonl: '',
    });
    await expect(prepareWorkunitSource({ rootNodeId: 'root' })).rejects.toMatchObject({
      bridgeError: { code: 'PAYLOAD_TOO_LARGE', nodeId: 'root' },
    });
  });
});
