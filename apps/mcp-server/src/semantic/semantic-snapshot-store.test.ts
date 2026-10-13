import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ExportSemanticScopeRpcResult } from '@figma-agent/protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { SessionWorkspace } from '../storage/session-workspace.js';
import { SemanticSnapshotStore } from './semantic-snapshot-store.js';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const cleanupPaths: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  cleanupPaths.push(directory);
  return directory;
}

async function setup(bind = true) {
  const home = await temporaryDirectory('figma-semantic-home-');
  const project = await temporaryDirectory('figma-semantic-project-');
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
    store: new SemanticSnapshotStore(workspace, {
      now: () => new Date('2026-10-11T00:00:00.000Z'),
      pluginVersion: () => '2.2.7',
    }),
  };
}

function result(
  profile: 'OUTLINE' | 'IMPLEMENTATION' = 'IMPLEMENTATION',
): ExportSemanticScopeRpcResult {
  return {
    rootNodeId: '84:681',
    rootNodeName: '侧栏',
    document: { name: 'Community' },
    page: { id: 'page:1', name: 'Home' },
    profile,
    request: {
      focusNodeIds: [],
      includeRender: false,
      depth: 8,
      maxNodes: 200,
      maxTextLength: 500,
    },
    sourceFingerprint: '12345678abcdef00',
    nodeCount: 2,
    complete: true,
    truncation: null,
    outlineJsonl: '{"nodeId":"84:681"}\n',
    factsJsonl: profile === 'OUTLINE' ? '' : '{"nodeId":"84:682"}\n',
  };
}

afterEach(async () => {
  for (const path of cleanupPaths.splice(0).reverse()) {
    await rm(path, { recursive: true, force: true });
  }
});

describe('SemanticSnapshotStore', () => {
  it('把正文写入会话目录并只返回路径和摘要', async () => {
    const { project, store } = await setup();
    const stored = await store.write(result());

    expect(stored).toMatchObject({
      sessionId: SESSION_ID,
      delivery: 'WORKSPACE',
      requiresCopy: false,
      complete: true,
    });
    expect(stored.projectRelativePath).toContain(
      `.figma_bridge_agent/sessions/${SESSION_ID}/scopes/`,
    );
    const manifest = JSON.parse(await readFile(stored.manifestPath, 'utf8'));
    expect(manifest).toMatchObject({
      rootNodeId: '84:681',
      profile: 'IMPLEMENTATION',
      sourceFingerprint: '12345678abcdef00',
      files: { outline: 'outline.jsonl', facts: 'facts.jsonl' },
    });
    await expect(
      readFile(join(project, '.figma_bridge_agent', '.gitignore'), 'utf8'),
    ).resolves.toBe('*\n');
  });

  it('相同源指纹的不同 profile 使用独立快照变体', async () => {
    const { store } = await setup();
    const outline = await store.write(result('OUTLINE'));
    const implementation = await store.write(result('IMPLEMENTATION'));

    expect(outline.projectRelativePath).not.toBe(implementation.projectRelativePath);
    expect(outline.sourceFingerprint).toBe(implementation.sourceFingerprint);
  });

  it('STAGED 语义写入会冻结共享根，禁止随后绑定工作区', async () => {
    const { project, workspace, store } = await setup(false);
    const stored = await store.write(result());
    expect(stored).toMatchObject({ delivery: 'STAGED', requiresCopy: true });
    await expect(workspace.bindRoot(project, SESSION_ID)).rejects.toMatchObject({
      bridgeError: { code: 'EXPORT_ROOT_CONFLICT' },
    });
  });
});
