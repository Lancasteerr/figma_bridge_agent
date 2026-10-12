import { access, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { TemporaryArtifactStore } from './artifact-store.js';

const cleanupPaths: string[] = [];

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
    const store = new TemporaryArtifactStore({ baseDirectory: testRoot(), now: () => now });
    await store.initialize();

    const stored = await store.write('../preview.png', Buffer.from('png'));

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

  it('启动时清理异常退出遗留的过期会话', async () => {
    const baseDirectory = testRoot();
    const orphanDirectory = join(baseDirectory, 'orphan-session');
    const orphan = join(orphanDirectory, 'tree.jsonl');
    await mkdir(orphanDirectory, { recursive: true });
    await writeFile(orphan, '{}\n');
    const old = new Date(Date.now() - 31 * 60_000);
    await utimes(orphan, old, old);

    const store = new TemporaryArtifactStore({ baseDirectory });
    await store.initialize();

    await expect(access(orphan)).rejects.toThrow();
    await store.close();
  });

  it('并发写入也不能突破会话配额', async () => {
    const store = new TemporaryArtifactStore({
      baseDirectory: testRoot(),
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
    const store = new TemporaryArtifactStore({ baseDirectory: testRoot() });
    await store.initialize();
    const stored = await store.write('tree.jsonl', '{}\n');

    await store.close();

    await expect(access(stored.localPath)).rejects.toThrow();
  });
});
