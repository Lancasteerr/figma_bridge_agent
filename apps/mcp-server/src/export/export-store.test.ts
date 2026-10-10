import { createHash } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ExportStore } from './export-store.js';

const cleanupPaths: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'figma-export-store-test-'));
  cleanupPaths.push(directory);
  return directory;
}

afterEach(async () => {
  // Windows junction 与目标目录并行删除会互相竞争，按登记逆序串行清理。
  for (const path of cleanupPaths.splice(0).reverse()) {
    await rm(path, { recursive: true, force: true });
  }
});

describe('ExportStore', () => {
  it('将启动时可写 cwd 固化为 WORKSPACE 根', async () => {
    const cwd = await temporaryDirectory();
    const store = new ExportStore({
      cwd,
      homeDirectory: await temporaryDirectory(),
      sessionId: '11111111-1111-4111-8111-111111111111',
    });
    await store.initialize();

    expect(store.status).toMatchObject({ delivery: 'WORKSPACE', rootPath: await realpath(cwd) });
    const result = await store.write({
      relativePath: 'src/assets/logo.svg',
      data: '<svg />',
      writePolicy: 'REUSE_OR_FAIL',
    });
    expect(result.status).toBe('CREATED');
    await expect(readFile(join(cwd, 'src/assets/logo.svg'), 'utf8')).resolves.toBe('<svg />');
  });

  it('cwd 不可用时创建独立且保留 24 小时的 STAGED 会话', async () => {
    const home = await temporaryDirectory();
    const first = new ExportStore({
      cwd: null,
      homeDirectory: home,
      sessionId: '11111111-1111-4111-8111-111111111111',
      now: () => Date.parse('2026-01-01T00:00:00.000Z'),
    });
    const second = new ExportStore({
      cwd: null,
      homeDirectory: home,
      sessionId: '22222222-2222-4222-8222-222222222222',
      now: () => Date.parse('2026-01-01T00:00:00.000Z'),
    });
    await first.initialize();
    await second.initialize();

    expect(first.status).toMatchObject({
      delivery: 'STAGED',
      fallbackExpiresAt: '2026-01-02T00:00:00.000Z',
    });
    expect(first.status.rootPath).not.toBe(second.status.rootPath);
    const stored = await first.write({
      relativePath: 'public/image.png',
      data: Uint8Array.from([1]),
      writePolicy: 'REUSE_OR_FAIL',
    });
    expect(stored.projectRelativePath).toBe('public/image.png');
    expect(stored.absolutePath).toBe(join(first.status.rootPath, 'public/image.png'));
  });

  it.each([
    '../outside.png',
    'a/../outside.png',
    '/absolute.png',
    'C:\\absolute.png',
    '\\\\server\\share\\a.png',
    'a//b.png',
  ])('拒绝越界或非规范相对路径 %s', async (relativePath) => {
    const cwd = await temporaryDirectory();
    const store = new ExportStore({ cwd, homeDirectory: await temporaryDirectory() });
    await store.initialize();
    await expect(
      store.write({ relativePath, data: 'x', writePolicy: 'REUSE_OR_FAIL' }),
    ).rejects.toMatchObject({ bridgeError: { code: 'EXPORT_PATH_INVALID' } });
  });

  it('同内容复用，不同内容冲突，正确旧哈希才允许覆盖', async () => {
    const cwd = await temporaryDirectory();
    const store = new ExportStore({ cwd, homeDirectory: await temporaryDirectory() });
    await store.initialize();
    const request = {
      relativePath: 'assets/avatar.png',
      data: 'first',
      writePolicy: 'REUSE_OR_FAIL' as const,
    };
    const created = await store.write(request);
    const reused = await store.write(request);
    expect(created.status).toBe('CREATED');
    expect(reused.status).toBe('REUSED');

    await expect(store.write({ ...request, data: 'second' })).rejects.toMatchObject({
      bridgeError: { code: 'EXPORT_TARGET_CONFLICT' },
    });
    await expect(
      store.write({
        ...request,
        data: 'second',
        writePolicy: 'OVERWRITE',
        expectedExistingSha256: '0'.repeat(64),
      }),
    ).rejects.toMatchObject({ bridgeError: { code: 'EXPORT_TARGET_CONFLICT' } });

    const updated = await store.write({
      ...request,
      data: 'second',
      writePolicy: 'OVERWRITE',
      expectedExistingSha256: createHash('sha256').update('first').digest('hex'),
    });
    expect(updated.status).toBe('UPDATED');
    await expect(readFile(join(cwd, request.relativePath), 'utf8')).resolves.toBe('second');
  });

  it('拒绝通过目录 symlink/junction 或目标 symlink 写出根目录', async () => {
    const cwd = await temporaryDirectory();
    const outside = await temporaryDirectory();
    const store = new ExportStore({ cwd, homeDirectory: await temporaryDirectory() });
    await store.initialize();
    await symlink(outside, join(cwd, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(
      store.write({
        relativePath: 'linked/escape.png',
        data: 'x',
        writePolicy: 'REUSE_OR_FAIL',
      }),
    ).rejects.toMatchObject({ bridgeError: { code: 'EXPORT_PATH_INVALID' } });
    await unlink(join(cwd, 'linked'));

    // Windows 普通文件 symlink 需要开发者模式；junction 已覆盖 Windows 的越界入口。
    if (process.platform !== 'win32') {
      const outsideFile = join(outside, 'outside.png');
      await writeFile(outsideFile, 'outside');
      await symlink(outsideFile, join(cwd, 'target.png'));
      await expect(
        store.write({ relativePath: 'target.png', data: 'x', writePolicy: 'REUSE_OR_FAIL' }),
      ).rejects.toMatchObject({ bridgeError: { code: 'EXPORT_PATH_INVALID' } });
    }
  });

  it('启动时清理超过 24 小时的历史 fallback，但保留新会话', async () => {
    const home = await temporaryDirectory();
    const base = join(home, 'figma_bridge_agent_export');
    const stale = join(base, 'stale-session');
    const fresh = join(base, 'fresh-session');
    await mkdir(stale, { recursive: true });
    await mkdir(fresh, { recursive: true });
    const now = Date.parse('2026-01-02T12:00:00.000Z');
    await utimes(stale, new Date(now - 25 * 60 * 60_000), new Date(now - 25 * 60 * 60_000));
    await utimes(fresh, new Date(now - 23 * 60 * 60_000), new Date(now - 23 * 60 * 60_000));

    const store = new ExportStore({
      cwd: null,
      homeDirectory: home,
      sessionId: '33333333-3333-4333-8333-333333333333',
      now: () => now,
    });
    await store.initialize();

    const names = await readdir(base);
    expect(names).not.toContain('stale-session');
    expect(names).toContain('fresh-session');
    expect(names).toContain(store.sessionId);
  });

  it('STAGED 会话累计写入受 256 MiB 配额机制限制', async () => {
    const home = await temporaryDirectory();
    const store = new ExportStore({
      cwd: null,
      homeDirectory: home,
      maxStagedSessionBytes: 4,
    });
    await store.initialize();
    await store.write({ relativePath: 'a.bin', data: '123', writePolicy: 'REUSE_OR_FAIL' });
    await expect(
      store.write({ relativePath: 'b.bin', data: '45', writePolicy: 'REUSE_OR_FAIL' }),
    ).rejects.toMatchObject({ bridgeError: { code: 'LIMIT_EXCEEDED' } });
  });

  it('冲突失败不会留下临时文件', async () => {
    const cwd = await temporaryDirectory();
    const store = new ExportStore({ cwd, homeDirectory: await temporaryDirectory() });
    await store.initialize();
    await store.write({ relativePath: 'assets/a.png', data: 'a', writePolicy: 'REUSE_OR_FAIL' });
    await expect(
      store.write({ relativePath: 'assets/a.png', data: 'b', writePolicy: 'REUSE_OR_FAIL' }),
    ).rejects.toBeDefined();
    expect((await readdir(join(cwd, 'assets'))).filter((name) => name.endsWith('.tmp'))).toEqual(
      [],
    );
  });
});
