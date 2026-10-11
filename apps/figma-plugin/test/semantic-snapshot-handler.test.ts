import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fingerprintNodeTree: vi.fn(),
  serializeSemanticScope: vi.fn(),
}));

vi.mock('../src/main/serialization/node-snapshot.js', () => ({
  fingerprintNodeTree: mocks.fingerprintNodeTree,
}));
vi.mock('../src/main/serialization/semantic-snapshot.js', () => ({
  serializeSemanticScope: mocks.serializeSemanticScope,
}));

import { exportSemanticScope } from '../src/main/handlers/semantic-snapshot.js';

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
  mocks.serializeSemanticScope.mockResolvedValue({
    nodeCount: 1,
    complete: true,
    truncation: null,
    outlineJsonl: '{"nodeId":"root"}\n',
    factsJsonl: '',
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('语义快照 handler', () => {
  it('导出期间完整树变化时拒绝返回正文', async () => {
    mocks.fingerprintNodeTree
      .mockResolvedValueOnce('before-123')
      .mockResolvedValueOnce('after-456');

    await expect(
      exportSemanticScope({ rootNodeId: 'root', profile: 'OUTLINE' }),
    ).rejects.toMatchObject({
      bridgeError: { code: 'SEMANTIC_SOURCE_CHANGED', nodeId: 'root' },
    });
  });

  it('语义正文超过 12 MiB 时要求拆分范围', async () => {
    mocks.fingerprintNodeTree.mockResolvedValue('stable-123');
    mocks.serializeSemanticScope.mockResolvedValue({
      nodeCount: 1,
      complete: true,
      truncation: null,
      outlineJsonl: 'x'.repeat(12 * 1024 * 1024),
      factsJsonl: '',
    });

    await expect(
      exportSemanticScope({ rootNodeId: 'root', profile: 'OUTLINE' }),
    ).rejects.toMatchObject({
      bridgeError: { code: 'PAYLOAD_TOO_LARGE', nodeId: 'root' },
    });
  });
});
