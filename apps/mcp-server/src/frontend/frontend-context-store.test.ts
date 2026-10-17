import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { PrepareWorkunitRpcResult } from '@figma-agent/protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { SessionWorkspace } from '../storage/session-workspace.js';
import { FrontendContextStore } from './frontend-context-store.js';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const cleanupPaths: string[] = [];

async function setup(bind = true) {
  const home = await mkdtemp(join(tmpdir(), 'figma-workunit-home-'));
  const project = await mkdtemp(join(tmpdir(), 'figma-workunit-project-'));
  cleanupPaths.push(home, project);
  const workspace = new SessionWorkspace({
    homeDirectory: home,
    sessionId: SESSION_ID,
    pluginRoots: [],
  });
  await workspace.initialize();
  if (bind) await workspace.bindRoot(project, SESSION_ID);
  return {
    project,
    workspace,
    store: new FrontendContextStore(workspace, {
      now: () => new Date('2026-10-11T00:00:00.000Z'),
      pluginVersion: () => '3.0.1',
    }),
  };
}

function source(sourceFingerprint = '12345678abcdef00'): PrepareWorkunitRpcResult {
  return {
    rootNodeId: '84:681',
    rootNodeName: '侧栏',
    document: { name: 'Community' },
    page: { id: 'page:1', name: 'Home' },
    request: {
      rootNodeId: '84:681',
      factNodeIds: ['84:683', '84:682'],
      includePreview: false,
      depth: 8,
      maxNodes: 200,
      maxTextLength: 500,
    },
    sourceFingerprint,
    nodeCount: 2,
    complete: true,
    truncation: null,
    outlineJsonl: '{"nodeId":"84:681"}\n',
    factsJsonl: '{"nodeId":"84:682"}\n',
  };
}

afterEach(async () => {
  for (const path of cleanupPaths.splice(0).reverse()) {
    await rm(path, { recursive: true, force: true });
  }
});

describe('FrontendContextStore', () => {
  it('首次创建稳定 workunit、不可变来源和实施骨架', async () => {
    const { project, store } = await setup();
    const stored = await store.prepareWorkunit(source(), 'EXACT');

    expect(stored).toMatchObject({
      workUnitId: expect.stringMatching(/^workunit-[a-f0-9]{16}$/),
      sourceFingerprint: '12345678abcdef00',
      evidenceComplete: true,
      requiresMappingReview: false,
    });
    const root = join(project, stored.workUnitPath);
    const implementation = JSON.parse(await readFile(join(root, 'implementation.json'), 'utf8'));
    expect(implementation).toEqual({
      sourceFingerprint: '12345678abcdef00',
      fidelityPolicy: 'EXACT',
      state: 'PLANNED',
      targetFiles: [],
      mappings: {},
      assumptions: [],
      unresolvedDifferences: [],
    });
    const current = JSON.parse(await readFile(join(root, 'source', 'current.json'), 'utf8'));
    expect(current).toMatchObject({ workUnitId: stored.workUnitId, rootNodeId: '84:681' });
    await expect(
      readFile(join(root, 'source', '12345678abcdef00', current.variant, 'facts.jsonl'), 'utf8'),
    ).resolves.toContain('84:682');
  });

  it('相同事实范围幂等复用并忽略 factNodeIds 顺序', async () => {
    const { store } = await setup();
    const first = await store.prepareWorkunit(source(), 'EXACT');
    const reordered = source();
    reordered.request.factNodeIds = ['84:682', '84:683'];
    const second = await store.prepareWorkunit(reordered, 'EXACT');
    expect(second.workUnitId).toBe(first.workUnitId);
    expect(second.workUnitPath).toBe(first.workUnitPath);
  });

  it('来源刷新保留 implementation.json 的每个字节并要求复核映射', async () => {
    const { project, store } = await setup();
    const first = await store.prepareWorkunit(source(), 'EXACT');
    const implementationPath = join(project, first.workUnitPath, 'implementation.json');
    const agentOwned = `${JSON.stringify(
      {
        sourceFingerprint: first.sourceFingerprint,
        fidelityPolicy: 'EXACT',
        state: 'IMPLEMENTING',
        targetFiles: ['src/sidebar.tsx'],
        mappings: {
          '84:682': [{ path: 'src/sidebar.tsx', symbolOrSelector: 'SidebarItem' }],
        },
        assumptions: ['使用现有路由状态'],
        unresolvedDifferences: [],
      },
      null,
      4,
    )}\n`;
    await writeFile(implementationPath, agentOwned, 'utf8');

    const refreshed = await store.prepareWorkunit(source('fedcba9876543210'), 'BALANCED');
    expect(refreshed.workUnitId).toBe(first.workUnitId);
    expect(refreshed.requiresMappingReview).toBe(true);
    await expect(readFile(implementationPath, 'utf8')).resolves.toBe(agentOwned);
    const current = JSON.parse(
      await readFile(join(project, first.workUnitPath, 'source', 'current.json'), 'utf8'),
    );
    expect(current.sourceFingerprint).toBe('fedcba9876543210');
    await expect(store.resolveAssetSource(first.workUnitId)).rejects.toMatchObject({
      bridgeError: { code: 'WORKUNIT_SOURCE_STALE' },
    });
  });

  it('未绑定时拒绝写入，绑定后仍可创建 workunit', async () => {
    const { project, workspace, store } = await setup(false);
    await expect(store.prepareWorkunit(source(), 'EXACT')).rejects.toMatchObject({
      bridgeError: { code: 'EXPORT_ROOT_UNBOUND' },
    });
    await workspace.bindRoot(project, SESSION_ID);
    await expect(store.prepareWorkunit(source(), 'EXACT')).resolves.toMatchObject({
      evidenceComplete: true,
    });
  });
});
