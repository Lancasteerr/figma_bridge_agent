import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

import type { McpServer } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BridgeTransport } from '../bridge/transport.js';
import { TemporaryArtifactStore } from '../temp/artifact-store.js';
import { registerReadTools } from './register-read-tools.js';
import { TREE_PUBLIC_RESULT_BUDGET_BYTES } from './tree-delivery.js';

type ToolHandler = (input: Record<string, unknown>) => Promise<{
  isError?: boolean;
  content: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
}>;

const stores: TemporaryArtifactStore[] = [];
const cleanupPaths: string[] = [];
const SESSION_ID = '22222222-2222-4222-8222-222222222222';

afterEach(async () => {
  for (const store of stores.splice(0).reverse()) await store.close();
  for (const path of cleanupPaths.splice(0).reverse()) {
    await rm(path, { recursive: true, force: true });
  }
});

async function setup(tree: Record<string, unknown>) {
  const baseDirectory = await mkdtemp(join(tmpdir(), 'figma-tree-delivery-test-'));
  cleanupPaths.push(baseDirectory);
  const artifacts = new TemporaryArtifactStore({ baseDirectory, sessionId: SESSION_ID });
  await artifacts.initialize();
  stores.push(artifacts);
  const handlers = new Map<string, ToolHandler>();
  const server = {
    registerTool: (name: string, _definition: unknown, handler: ToolHandler) => {
      handlers.set(name, handler);
    },
  } as unknown as McpServer;
  const broker = {
    connected: true,
    request: vi.fn(async () => tree),
    onEvent: vi.fn(() => () => undefined),
    close: vi.fn(async () => undefined),
  } as unknown as BridgeTransport;
  registerReadTools(server, broker, artifacts);
  return {
    artifactRoot: artifacts.root,
    broker,
    handlers,
    handler: handlers.get('figma_get_tree')!,
  };
}

function node(id: string, name = `Node ${id}`, children: Record<string, unknown>[] = []) {
  return {
    id,
    parentId: id === 'root' ? 'page:1' : 'root',
    order: 0,
    name,
    type: 'FRAME',
    visible: true,
    geometry: {
      local: { x: 0, y: 0, width: 100, height: 80 },
      absolute: { x: 0, y: 0, width: 100, height: 80 },
      rotation: 0,
    },
    childCount: children.length,
    assetHints: {
      imagePaintCount: 0,
      exportSettingCount: 0,
      hasVector: false,
      isMask: false,
    },
    children,
  };
}

function tree(children: Record<string, unknown>[]) {
  const root = node('root', 'Root', children);
  const queue: Record<string, unknown>[] = [root];
  let nodeCount = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    nodeCount += 1;
    queue.push(...(current.children as Record<string, unknown>[]));
  }
  return {
    schemaVersion: 2,
    scope: { rootNodeId: 'root', requestedDepth: 2, maxNodes: 1_000 },
    coverage: { complete: true, nodeCount },
    root,
  };
}

describe('figma_get_raw_node MCP 投影', () => {
  it('把自节点默认值和字段投影发送给插件，只公开 node', async () => {
    const rpc = {
      nodeId: 'node:1',
      node: { id: 'node:1', name: 'Button', type: 'FRAME', reactions: [] },
      bytes: 80,
    };
    const { broker, handlers } = await setup(rpc);

    const response = await handlers.get('figma_get_raw_node')!({
      nodeId: 'node:1',
      fields: ['reactions'],
    });

    expect(broker.request).toHaveBeenCalledWith(
      'getRawNode',
      {
        nodeId: 'node:1',
        depth: 0,
        fields: ['reactions'],
        maxBytes: 256 * 1024,
      },
      30_000,
    );
    expect(response.structuredContent).toEqual({ node: rpc.node });
    expect(response.structuredContent).not.toHaveProperty('bytes');
  });
});

describe('figma_get_node MCP 投影', () => {
  it('默认不请求 children，并原样公开插件生成的紧凑事实', async () => {
    const compact = {
      name: 'Card',
      type: 'FRAME',
      geometry: {
        local: { x: 0, y: 0, width: 100, height: 80 },
        absolute: { x: 0, y: 0, width: 100, height: 80 },
      },
    };
    const { broker, handlers } = await setup(compact);

    const response = await handlers.get('figma_get_node')!({ nodeId: 'node:1' });

    expect(broker.request).toHaveBeenCalledWith('getNode', {
      nodeId: 'node:1',
      fields: ['GEOMETRY', 'LAYOUT', 'TEXT', 'VISUAL', 'ASSETS', 'COMPONENT'],
    });
    expect(response.structuredContent).toEqual(compact);
    expect(response.structuredContent).not.toHaveProperty('children');
    expect(response.structuredContent).not.toHaveProperty('snapshotFingerprint');
  });
});

describe('figma_get_tree MCP 交付', () => {
  it('小树在预算内完整内联，且交付策略不发送给插件', async () => {
    const { broker, handler } = await setup(tree([node('child')]));

    const response = await handler({ nodeId: 'root' });

    expect(response.content).toEqual([]);
    expect(response.structuredContent).not.toHaveProperty('artifact');
    expect(response.structuredContent?.root).toMatchObject({
      id: 'root',
      bounds: { x: 0, y: 0, width: 100, height: 80 },
      children: [{ id: 'child' }],
    });
    expect(response.structuredContent?.root).not.toHaveProperty('geometry');
    expect(broker.request).toHaveBeenCalledWith('getTree', {
      nodeId: 'root',
      depth: 2,
      maxNodes: 200,
      maxTextLength: 80,
    });
  });

  it('大树自动写入 JSONL，公开结果严格小于四十八 KiB', async () => {
    const children = Array.from({ length: 400 }, (_, index) =>
      node(`child-${index}`, `Branch ${index} ${'x'.repeat(180)}`),
    );
    const { artifactRoot, handler } = await setup(tree(children));

    const response = await handler({ nodeId: 'root', maxNodes: 1_000 });
    const artifact = response.structuredContent?.artifact as Record<string, unknown>;

    expect(artifact).toEqual({
      localPath: expect.any(String),
      expiresAt: expect.any(String),
    });
    expect(Buffer.byteLength(JSON.stringify(response), 'utf8')).toBeLessThanOrEqual(
      TREE_PUBLIC_RESULT_BUDGET_BYTES,
    );
    expect(String(artifact.localPath).startsWith(`${artifactRoot}${sep}`)).toBe(true);
    const lines = (await readFile(String(artifact.localPath), 'utf8')).trimEnd().split('\n');
    expect(JSON.parse(lines[0]!)).toMatchObject({ recordType: 'manifest', schemaVersion: 2 });
    expect(lines).toHaveLength(402);
    expect(JSON.parse(lines[1]!)).not.toHaveProperty('children');
  });

  it('显式 TEMP_FILE 会让小树落盘，但公开结果不暴露内部覆盖计数', async () => {
    const { handler } = await setup(tree([]));

    const response = await handler({ nodeId: 'root', delivery: 'TEMP_FILE' });

    expect(response.structuredContent).toMatchObject({
      root: { id: 'root', children: [] },
      artifact: { localPath: expect.any(String), expiresAt: expect.any(String) },
    });
    expect(response.structuredContent).not.toHaveProperty('coverage');
  });

  it('overview 在同一深度轮询各分支，不让首个分支独占预算', async () => {
    const branches = Array.from({ length: 8 }, (_, branchIndex) => {
      const leaves = Array.from({ length: 80 }, (_, leafIndex) =>
        node(
          `leaf-${branchIndex}-${leafIndex}`,
          `Leaf ${branchIndex}-${leafIndex} ${'x'.repeat(170)}`,
        ),
      );
      return node(`branch-${branchIndex}`, `Branch ${branchIndex}`, leaves);
    });
    const { handler } = await setup(tree(branches));

    const response = await handler({ nodeId: 'root', maxNodes: 1_000 });
    const root = response.structuredContent?.root as {
      children: Array<{ children: unknown[] }>;
    };
    const includedPerBranch = root.children.map((branch) => branch.children.length);

    expect(root.children).toHaveLength(8);
    expect(Math.max(...includedPerBranch) - Math.min(...includedPerBranch)).toBeLessThanOrEqual(1);
  });
});
