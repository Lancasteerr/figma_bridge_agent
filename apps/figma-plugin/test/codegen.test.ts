import { afterEach, describe, expect, it, vi } from 'vitest';

import { getRawNode } from '../src/main/handlers/codegen.js';

const page = { id: 'page:1', name: 'Page', type: 'PAGE', parent: null };

function stubRaw(raw: Record<string, unknown>) {
  const node = {
    id: 'node:1',
    name: 'Button',
    type: 'FRAME',
    parent: page,
    x: 0,
    width: 100,
    exportAsync: vi.fn(async () => raw),
  };
  vi.stubGlobal('figma', {
    currentPage: page,
    getNodeByIdAsync: vi.fn(async () => node),
  });
  return node;
}

afterEach(() => vi.unstubAllGlobals());

describe('原始节点投影', () => {
  it('默认保留身份和自节点字段，但移除 children', async () => {
    stubRaw({
      id: 'node:1',
      name: 'Button',
      type: 'FRAME',
      opacity: 0.8,
      children: [{ id: 'child:1', name: 'Label', type: 'TEXT', characters: 'Go' }],
    });

    await expect(getRawNode({ nodeId: 'node:1' })).resolves.toMatchObject({
      node: { id: 'node:1', name: 'Button', type: 'FRAME', opacity: 0.8 },
    });
    const result = await getRawNode({ nodeId: 'node:1' });
    expect(result.node).not.toHaveProperty('children');
  });

  it('按字段投影当前节点和一层 children，并始终保留身份字段', async () => {
    stubRaw({
      id: 'node:1',
      name: 'Button',
      type: 'FRAME',
      opacity: 0.8,
      reactions: [{ trigger: { type: 'ON_CLICK' } }],
      children: [
        {
          id: 'child:1',
          name: 'Label',
          type: 'TEXT',
          opacity: 1,
          reactions: [],
          children: [{ id: 'grandchild:1', name: 'Nested', type: 'TEXT' }],
        },
      ],
    });

    const result = await getRawNode({
      nodeId: 'node:1',
      depth: 1,
      fields: ['reactions', 'missingField'],
    });

    expect(result.node).toEqual({
      id: 'node:1',
      name: 'Button',
      type: 'FRAME',
      reactions: [{ trigger: { type: 'ON_CLICK' } }],
      children: [{ id: 'child:1', name: 'Label', type: 'TEXT', reactions: [] }],
    });
  });

  it('在字段和深度投影后执行 UTF-8 字节上限', async () => {
    stubRaw({
      id: 'node:1',
      name: 'Button',
      type: 'FRAME',
      description: '界'.repeat(600),
      children: [{ id: 'child:1', name: 'x'.repeat(4_000), type: 'TEXT' }],
    });

    await expect(
      getRawNode({ nodeId: 'node:1', fields: ['description'], maxBytes: 1_024 }),
    ).rejects.toMatchObject({ bridgeError: { code: 'PAYLOAD_TOO_LARGE' } });
    await expect(
      getRawNode({ nodeId: 'node:1', fields: ['missingField'], maxBytes: 1_024 }),
    ).resolves.toMatchObject({ node: { id: 'node:1', name: 'Button', type: 'FRAME' } });
  });
});
