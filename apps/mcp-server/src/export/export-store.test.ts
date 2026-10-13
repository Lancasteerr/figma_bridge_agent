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
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ExportStore } from './export-store.js';

const cleanupPaths: string[] = [];
const SESSION_ID = '11111111-1111-4111-8111-111111111111';

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'figma-export-store-test-'));
  cleanupPaths.push(directory);
  return directory;
}

async function initializedStore(
  options: {
    homeDirectory?: string;
    sessionId?: string;
    pluginRoots?: readonly string[];
  } = {},
): Promise<ExportStore> {
  const store = new ExportStore({
    homeDirectory: options.homeDirectory ?? (await temporaryDirectory()),
    sessionId: options.sessionId ?? SESSION_ID,
    pluginRoots: options.pluginRoots ?? [],
  });
  await store.initialize();
  return store;
}

afterEach(async () => {
  // Windows junction 与目标目录并行删除会互相竞争，按登记逆序串行清理。
  for (const path of cleanupPaths.splice(0).reverse()) {
    await rm(path, { recursive: true, force: true });
  }
});

describe('ExportStore', () => {
  it('启动时保持 UNBOUND，未绑定写入返回明确错误且不创建暂存目录', async () => {
    const home = await temporaryDirectory();
    const store = await initializedStore({ homeDirectory: home });

    expect(store.status).toEqual({ state: 'UNBOUND', sessionId: SESSION_ID });
    await expect(
      store.write({
        relativePath: 'public/image.png',
        data: Uint8Array.from([1]),
        writePolicy: 'REUSE_OR_FAIL',
      }),
    ).rejects.toMatchObject({ bridgeError: { code: 'EXPORT_ROOT_UNBOUND', retryable: true } });
    await expect(readdir(home)).resolves.toEqual([]);
  });

  it('绑定 Agent 工作区后冻结 WORKSPACE 根并直接写入', async () => {
    const workspace = await temporaryDirectory();
    const store = await initializedStore();

    const status = await store.bindRoot(workspace, SESSION_ID);
    expect(status).toEqual({
      state: 'BOUND',
      rootPath: await realpath(workspace),
      sessionId: SESSION_ID,
    });
    const result = await store.write({
      relativePath: 'src/assets/logo.svg',
      data: '<svg />',
      writePolicy: 'REUSE_OR_FAIL',
    });
    expect(result.status).toBe('CREATED');
    await expect(readFile(join(workspace, 'src/assets/logo.svg'), 'utf8')).resolves.toBe('<svg />');
  });

  it('相同规范根幂等绑定，不同根拒绝重绑定', async () => {
    const workspace = await temporaryDirectory();
    const other = await temporaryDirectory();
    const store = await initializedStore();

    const first = await store.bindRoot(join(workspace, '.'), SESSION_ID);
    const second = await store.bindRoot(workspace, SESSION_ID);
    expect(second).toEqual(first);
    await expect(store.bindRoot(other, SESSION_ID)).rejects.toMatchObject({
      bridgeError: { code: 'EXPORT_ROOT_CONFLICT', retryable: false },
    });
  });

  it('拒绝过期会话与并发绑定', async () => {
    const workspace = await temporaryDirectory();
    const store = await initializedStore();

    await expect(
      store.bindRoot(workspace, '22222222-2222-4222-8222-222222222222'),
    ).rejects.toMatchObject({ bridgeError: { code: 'EXPORT_SESSION_MISMATCH', retryable: true } });

    const binding = store.bindRoot(workspace, SESSION_ID);
    await expect(store.bindRoot(workspace, SESSION_ID)).rejects.toMatchObject({
      bridgeError: { code: 'BUSY', retryable: true },
    });
    await expect(
      store.write({ relativePath: 'during-bind.bin', data: 'x', writePolicy: 'REUSE_OR_FAIL' }),
    ).rejects.toMatchObject({ bridgeError: { code: 'BUSY', retryable: true } });
    await binding;
  });

  it('多个 Adapter 会话独立绑定且互不污染', async () => {
    const firstRoot = await temporaryDirectory();
    const secondRoot = await temporaryDirectory();
    const first = await initializedStore();
    const secondSessionId = '22222222-2222-4222-8222-222222222222';
    const second = await initializedStore({ sessionId: secondSessionId });

    await first.bindRoot(firstRoot, SESSION_ID);
    expect(first.status).toMatchObject({
      state: 'BOUND',
      rootPath: await realpath(firstRoot),
    });
    expect(second.status).toEqual({ state: 'UNBOUND', sessionId: secondSessionId });

    await second.bindRoot(secondRoot, secondSessionId);
    expect(second.status).toMatchObject({
      state: 'BOUND',
      rootPath: await realpath(secondRoot),
    });
    expect(first.status).toMatchObject({ rootPath: await realpath(firstRoot) });
  });

  it('拒绝相对路径、文件系统根、用户主目录和插件目录', async () => {
    const home = await temporaryDirectory();
    const pluginRoot = await temporaryDirectory();
    const pluginChild = join(pluginRoot, 'child');
    await mkdir(pluginChild);
    const file = join(await temporaryDirectory(), 'file.txt');
    await writeFile(file, 'x');
    const store = await initializedStore({ homeDirectory: home, pluginRoots: [pluginRoot] });
    const invalidRoots = ['relative/path', parse(home).root, home, pluginRoot, pluginChild, file];

    for (const rootPath of invalidRoots) {
      await expect(store.bindRoot(rootPath, SESSION_ID)).rejects.toMatchObject({
        bridgeError: { code: 'EXPORT_ROOT_INVALID', retryable: false },
      });
    }
  });

  it.each([
    '../outside.png',
    'a/../outside.png',
    '/absolute.png',
    'C:\\absolute.png',
    '\\\\server\\share\\a.png',
    'a//b.png',
  ])('拒绝越界或非规范相对路径 %s', async (relativePath) => {
    const store = await initializedStore();
    const workspace = await temporaryDirectory();
    await store.bindRoot(workspace, SESSION_ID);
    await expect(
      store.write({ relativePath, data: 'x', writePolicy: 'REUSE_OR_FAIL' }),
    ).rejects.toMatchObject({ bridgeError: { code: 'EXPORT_PATH_INVALID' } });
  });

  it('同内容复用，不同内容冲突，正确旧哈希才允许覆盖', async () => {
    const workspace = await temporaryDirectory();
    const store = await initializedStore();
    await store.bindRoot(workspace, SESSION_ID);
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
    await expect(readFile(join(workspace, request.relativePath), 'utf8')).resolves.toBe('second');
  });

  it('拒绝通过目录 symlink/junction 或目标 symlink 写出根目录', async () => {
    const workspace = await temporaryDirectory();
    const outside = await temporaryDirectory();
    const store = await initializedStore();
    await store.bindRoot(workspace, SESSION_ID);
    await symlink(
      outside,
      join(workspace, 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(
      store.write({
        relativePath: 'linked/escape.png',
        data: 'x',
        writePolicy: 'REUSE_OR_FAIL',
      }),
    ).rejects.toMatchObject({ bridgeError: { code: 'EXPORT_PATH_INVALID' } });
    await unlink(join(workspace, 'linked'));

    // Windows 普通文件 symlink 需要开发者模式；junction 已覆盖 Windows 的越界入口。
    if (process.platform !== 'win32') {
      const outsideFile = join(outside, 'outside.png');
      await writeFile(outsideFile, 'outside');
      await symlink(outsideFile, join(workspace, 'target.png'));
      await expect(
        store.write({ relativePath: 'target.png', data: 'x', writePolicy: 'REUSE_OR_FAIL' }),
      ).rejects.toMatchObject({ bridgeError: { code: 'EXPORT_PATH_INVALID' } });
    }
  });

  it('冲突失败不会留下临时文件', async () => {
    const workspace = await temporaryDirectory();
    const store = await initializedStore();
    await store.bindRoot(workspace, SESSION_ID);
    await store.write({ relativePath: 'assets/a.png', data: 'a', writePolicy: 'REUSE_OR_FAIL' });
    await expect(
      store.write({ relativePath: 'assets/a.png', data: 'b', writePolicy: 'REUSE_OR_FAIL' }),
    ).rejects.toBeDefined();
    expect(
      (await readdir(join(workspace, 'assets'))).filter((name) => name.endsWith('.tmp')),
    ).toEqual([]);
  });
});
