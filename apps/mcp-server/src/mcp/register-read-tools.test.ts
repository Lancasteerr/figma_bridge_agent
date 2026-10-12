import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

afterEach(async () => {
  for (const store of stores.splice(0).reverse()) await store.close();
  for (const path of cleanupPaths.splice(0).reverse()) {
    await rm(path, { recursive: true, force: true });
  }
});

async function setup(tree: Record<string, unknown>) {
  const baseDirectory = await mkdtemp(join(tmpdir(), 'figma-tree-delivery-test-'));
  cleanupPaths.push(baseDirectory);
  const artifacts = new TemporaryArtifactStore({ baseDirectory });
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
  return { broker, handler: handlers.get('figma_get_tree')! };
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
  return {
    schemaVersion: 2,
    scope: { rootNodeId: 'root', requestedDepth: 2, maxNodes: 1_000 },
    coverage: { complete: true, nodeCount: children.length + 1 },
    root: node('root', 'Root', children),
  };
}

describe('figma_get_tree MCP 交付', () => {
  it('小树在预算内完整内联，且交付策略不发送给插件', async () => {
    const { broker, handler } = await setup(tree([node('child')]));

    const response = await handler({ nodeId: 'root' });

    expect(response.content).toEqual([]);
    expect(response.structuredContent?.delivery).toEqual({
      mode: 'INLINE',
      inlineComplete: true,
      inlineNodeCount: 2,
    });
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
    const { handler } = await setup(tree(children));

    const response = await handler({ nodeId: 'root', maxNodes: 1_000 });
    const delivery = response.structuredContent?.delivery as Record<string, unknown>;

    expect(delivery).toMatchObject({
      mode: 'TEMP_FILE',
      inlineComplete: false,
      artifactNodeCount: 401,
    });
    expect(Buffer.byteLength(JSON.stringify(response), 'utf8')).toBeLessThanOrEqual(
      TREE_PUBLIC_RESULT_BUDGET_BYTES,
    );
    const lines = (await readFile(String(delivery.localPath), 'utf8')).trimEnd().split('\n');
    expect(JSON.parse(lines[0]!)).toMatchObject({ recordType: 'manifest', schemaVersion: 2 });
    expect(lines).toHaveLength(402);
    expect(JSON.parse(lines[1]!)).not.toHaveProperty('children');
  });

  it('显式 TEMP_FILE 会让小树落盘，但不会改变 coverage 完整性', async () => {
    const { handler } = await setup(tree([]));

    const response = await handler({ nodeId: 'root', delivery: 'TEMP_FILE' });

    expect(response.structuredContent).toMatchObject({
      coverage: { complete: true, nodeCount: 1 },
      delivery: {
        mode: 'TEMP_FILE',
        inlineComplete: false,
        inlineNodeCount: 1,
        artifactNodeCount: 1,
      },
    });
  });
});
