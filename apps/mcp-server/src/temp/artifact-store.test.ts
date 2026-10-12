import { access, mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { TemporaryArtifactStore } from './artifact-store.js';

const cleanupPaths: string[] = [];
const SESSION_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SESSION_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

afterEach(async () => {
  for (const path of cleanupPaths.splice(0).reverse()) {
    await rm(path, { recursive: true, force: true });
  }
});

function testRoot(): string {
  const path = join(tmpdir(), `figma-artifact-store-test-${crypto.randomUUID()}`);
  cleanupPaths.push(path);
  return path;
}

describe('TemporaryArtifactStore', () => {
  it('返回摘要和三十分钟生命周期元数据', async () => {
    const now = Date.parse('2026-10-13T00:00:00.000Z');
    const baseDirectory = testRoot();
    const store = new TemporaryArtifactStore({
      baseDirectory,
      sessionId: SESSION_A,
      now: () => now,
    });
    await store.initialize();

    const stored = await store.write('../preview.png', Buffer.from('png'));

    expect(store.root).toBe(join(baseDirectory, SESSION_A));
    expect(stored.localPath.startsWith(store.root)).toBe(true);
    expect(stored.localPath).toMatch(/preview\.png$/);
    expect(stored).toMatchObject({
      bytes: 3,
      createdAt: '2026-10-13T00:00:00.000Z',
      expiresAt: '2026-10-13T00:30:00.000Z',
    });
    await expect(readFile(stored.localPath, 'utf8')).resolves.toBe('png');
    await store.close();
  });

  it('到期后删除文件并回收当前会话配额', async () => {
    let now = 1_000;
    const store = new TemporaryArtifactStore({
      baseDirectory: testRoot(),
      sessionId: SESSION_A,
      maxSessionBytes: 4,
      ttlMs: 100,
      now: () => now,
    });
    await store.initialize();
    const first = await store.write('first.bin', Buffer.from('1234'));
    await expect(store.write('full.bin', Buffer.from('1'))).rejects.toThrow('quota exceeded');

    now += 101;
    await store.sweepExpired();
    await expect(access(first.localPath)).rejects.toThrow();
    await expect(store.write('second.bin', Buffer.from('1234'))).resolves.toMatchObject({
      bytes: 4,
    });
    await store.close();
  });

  it('启动时只清理超过二十四小时的异常会话目录', async () => {
    const baseDirectory = testRoot();
    const staleDirectory = join(baseDirectory, 'stale-session');
    const freshDirectory = join(baseDirectory, 'fresh-session');
    const freshEmptyDirectory = join(baseDirectory, 'fresh-empty-session');
    const oldFileInFreshDirectory = join(freshDirectory, 'old-tree.jsonl');
    await mkdir(staleDirectory, { recursive: true });
    await mkdir(freshDirectory, { recursive: true });
    await mkdir(freshEmptyDirectory, { recursive: true });
    await writeFile(oldFileInFreshDirectory, '{}\n');
    const now = Date.parse('2026-10-13T00:00:00.000Z');
    const stale = new Date(now - 24 * 60 * 60_000 - 1);
    const fresh = new Date(now - 24 * 60 * 60_000 + 1);
    await utimes(staleDirectory, stale, stale);
    await utimes(oldFileInFreshDirectory, stale, stale);
    await utimes(freshDirectory, fresh, fresh);
    await utimes(freshEmptyDirectory, fresh, fresh);

    const store = new TemporaryArtifactStore({
      baseDirectory,
      sessionId: SESSION_A,
      now: () => now,
    });
    await store.initialize();

    await expect(access(staleDirectory)).rejects.toThrow();
    await expect(access(freshDirectory)).resolves.toBeUndefined();
    await expect(access(oldFileInFreshDirectory)).resolves.toBeUndefined();
    await expect(access(freshEmptyDirectory)).resolves.toBeUndefined();
    await store.close();
  });

  it('另一个 Adapter 初始化时保留新建空会话目录', async () => {
    const baseDirectory = testRoot();
    const first = new TemporaryArtifactStore({ baseDirectory, sessionId: SESSION_A });
    const second = new TemporaryArtifactStore({ baseDirectory, sessionId: SESSION_B });
    await first.initialize();
    await second.initialize();

    await expect(access(first.root)).resolves.toBeUndefined();
    await expect(first.write('preview.png', Buffer.from('png'))).resolves.toMatchObject({
      bytes: 3,
    });

    await second.close();
    await first.close();
  });

  it('临时文件直接写入会话目录并更新目录修改时间', async () => {
    const store = new TemporaryArtifactStore({
      baseDirectory: testRoot(),
      sessionId: SESSION_A,
    });
    await store.initialize();
    const old = new Date('2000-01-01T00:00:00.000Z');
    await utimes(store.root, old, old);

    const stored = await store.write('tree.jsonl', '{}\n');

    expect(dirname(stored.localPath)).toBe(store.root);
    expect((await stat(store.root)).mtimeMs).toBeGreaterThan(old.getTime());
    await store.close();
  });

  it('会话目录被外部删除后下一次写入会自动重建', async () => {
    const store = new TemporaryArtifactStore({
      baseDirectory: testRoot(),
      sessionId: SESSION_A,
    });
    await store.initialize();
    await rm(store.root, { recursive: true, force: true });

    const stored = await store.write('preview.png', Buffer.from('png'));

    await expect(readFile(stored.localPath, 'utf8')).resolves.toBe('png');
    await store.close();
  });

  it('并发写入也不能突破会话配额', async () => {
    const store = new TemporaryArtifactStore({
      baseDirectory: testRoot(),
      sessionId: SESSION_A,
      maxSessionBytes: 4,
    });
    await store.initialize();

    const results = await Promise.allSettled([
      store.write('first.bin', Buffer.from('123')),
      store.write('second.bin', Buffer.from('456')),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    await store.close();
  });

  it('正常关闭时立即删除当前会话目录', async () => {
    const store = new TemporaryArtifactStore({
      baseDirectory: testRoot(),
      sessionId: SESSION_A,
    });
    await store.initialize();
    const stored = await store.write('tree.jsonl', '{}\n');

    await store.close();

    await expect(access(stored.localPath)).rejects.toThrow();
  });
});
