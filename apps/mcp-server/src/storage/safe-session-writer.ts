import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { BridgeFault } from '@figma-agent/protocol';

import type { SessionWorkspace } from './session-workspace.js';

export interface SessionWriteRequest {
  relativePath: string;
  data: Uint8Array | string;
  writePolicy: 'REUSE_OR_FAIL' | 'OVERWRITE';
  expectedExistingSha256?: string;
}

export interface SessionWriteResult {
  status: 'CREATED' | 'REUSED' | 'UPDATED';
  absolutePath: string;
  projectRelativePath: string;
  sha256: string;
  bytes: number;
}

interface PreparedSessionWrite extends SessionWriteResult {
  request: SessionWriteRequest;
  data: Uint8Array;
  target: string;
  existing: boolean;
  existingSha256?: string;
  temporary?: string;
  backup?: string;
  committed?: boolean;
  backupMoved?: boolean;
}

/** 在共享会话根下执行经过边界检查的原子文件写入。 */
export class SafeSessionWriter {
  constructor(private readonly workspace: SessionWorkspace) {}

  async write(request: SessionWriteRequest): Promise<SessionWriteResult> {
    const status = this.workspace.beginWrite();
    const projectRelativePath = normalizeRelativePath(request.relativePath);
    const target = resolve(status.rootPath, ...projectRelativePath.split('/'));
    assertContained(status.rootPath, target);
    const data =
      typeof request.data === 'string' ? Buffer.from(request.data, 'utf8') : request.data;
    const bytes = data.byteLength;
    const sha256 = digest(data);

    const parent = dirname(target);
    await assertNearestExistingParentWithinRoot(status.rootPath, parent);
    await mkdir(parent, { recursive: true });
    assertContained(status.rootPath, await realpath(parent));

    const existing = await inspectTarget(target);
    if (existing) {
      const existingSha256 = digest(await readFile(target));
      if (existingSha256 === sha256) {
        return { status: 'REUSED', absolutePath: target, projectRelativePath, sha256, bytes };
      }
      if (
        request.writePolicy !== 'OVERWRITE' ||
        !request.expectedExistingSha256 ||
        request.expectedExistingSha256 !== existingSha256
      ) {
        throw new BridgeFault({
          code: 'EXPORT_TARGET_CONFLICT',
          message: `Export target already exists with different content: ${projectRelativePath}`,
          retryable: true,
          details: { existingSha256, newSha256: sha256 },
        });
      }
    }

    const temporary = join(parent, `.${randomUUID()}.figma-export.tmp`);
    try {
      await writeFile(temporary, data, { flag: 'wx' });
      if (existing) {
        const currentSha256 = digest(await readFile(target));
        if (currentSha256 !== request.expectedExistingSha256) {
          throw new BridgeFault({
            code: 'EXPORT_TARGET_CONFLICT',
            message: `Export target changed concurrently: ${projectRelativePath}`,
            retryable: true,
            details: {
              expectedExistingSha256: request.expectedExistingSha256,
              actualExistingSha256: currentSha256,
              newSha256: sha256,
            },
          });
        }
      }
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }

    return {
      status: existing ? 'UPDATED' : 'CREATED',
      absolutePath: target,
      projectRelativePath,
      sha256,
      bytes,
    };
  }

  /**
   * 先暂存并复检整个批次，再统一提交；任一提交失败时恢复本批次已触碰的目标。
   * 该事务只覆盖本进程的文件操作，外部进程仍通过提交前摘要复检检测竞争写入。
   */
  async writeBatch(requests: readonly SessionWriteRequest[]): Promise<SessionWriteResult[]> {
    const status = this.workspace.beginWrite();
    const prepared: PreparedSessionWrite[] = [];
    const pathKeys = new Set<string>();
    let stagingDirectory: string | undefined;

    for (const request of requests) {
      const projectRelativePath = normalizeRelativePath(request.relativePath);
      const target = resolve(status.rootPath, ...projectRelativePath.split('/'));
      assertContained(status.rootPath, target);
      const key = process.platform === 'win32' ? target.toLocaleLowerCase('en-US') : target;
      if (pathKeys.has(key)) {
        throw new BridgeFault({
          code: 'EXPORT_PATH_INVALID',
          message: `Batch export paths must be unique: ${projectRelativePath}`,
          retryable: false,
        });
      }
      pathKeys.add(key);
      const data =
        typeof request.data === 'string' ? Buffer.from(request.data, 'utf8') : request.data;
      prepared.push({
        request,
        data,
        target,
        projectRelativePath,
        sha256: digest(data),
        bytes: data.byteLength,
        existing: false,
        status: 'CREATED',
        absolutePath: target,
      });
    }

    try {
      // 路径、已有目标和覆盖条件全部通过后，才为每个待更新项创建暂存文件。
      for (const item of prepared) {
        const parent = dirname(item.target);
        await assertNearestExistingParentWithinRoot(status.rootPath, parent);
        await mkdir(parent, { recursive: true });
        assertContained(status.rootPath, await realpath(parent));
        item.existing = await inspectTarget(item.target);
        if (item.existing) {
          item.existingSha256 = digest(await readFile(item.target));
          if (item.existingSha256 === item.sha256) {
            item.status = 'REUSED';
            continue;
          }
          if (
            item.request.writePolicy !== 'OVERWRITE' ||
            !item.request.expectedExistingSha256 ||
            item.request.expectedExistingSha256 !== item.existingSha256
          ) {
            throw targetConflict(
              `Export target already exists with different content: ${item.projectRelativePath}`,
              { existingSha256: item.existingSha256, newSha256: item.sha256 },
            );
          }
          item.status = 'UPDATED';
        }
      }

      stagingDirectory = resolve(
        status.rootPath,
        '.figma_bridge_agent',
        'sessions',
        this.workspace.sessionId,
        'staging',
        randomUUID(),
      );
      assertContained(status.rootPath, stagingDirectory);
      await assertNearestExistingParentWithinRoot(status.rootPath, stagingDirectory);
      await mkdir(stagingDirectory, { recursive: true });
      assertContained(status.rootPath, await realpath(stagingDirectory));
      for (const [index, item] of prepared.entries()) {
        item.temporary = join(stagingDirectory, `${index}.figma-export.tmp`);
        await writeFile(item.temporary, item.data, { flag: 'wx' });
      }

      // 暂存完成后统一复检，避免批次在冲突已知时发生任何项目文件更新。
      for (const item of prepared.filter((entry) => entry.status !== 'REUSED')) {
        const existsNow = await inspectTarget(item.target);
        if (!item.existing && existsNow) {
          throw targetConflict(`Export target appeared concurrently: ${item.projectRelativePath}`);
        }
        if (item.existing) {
          const currentSha256 = existsNow ? digest(await readFile(item.target)) : undefined;
          if (currentSha256 !== item.existingSha256) {
            throw targetConflict(
              `Export target changed concurrently: ${item.projectRelativePath}`,
              { expectedExistingSha256: item.existingSha256, actualExistingSha256: currentSha256 },
            );
          }
        }
      }

      // 先把旧文件移到同目录备份，再用硬链接发布完整暂存内容，避免半写文件可见。
      for (const item of prepared.filter(
        (entry) => entry.status === 'UPDATED' && entry.temporary,
      )) {
        item.backup = join(dirname(item.target), `.${randomUUID()}.figma-export.bak`);
        await rename(item.target, item.backup);
        item.backupMoved = true;
      }
      for (const item of prepared.filter((entry) => entry.status !== 'REUSED')) {
        await link(item.temporary!, item.target);
        item.committed = true;
      }
      for (const item of prepared) {
        if (item.temporary) await rm(item.temporary, { force: true }).catch(() => undefined);
        if (item.backup) await rm(item.backup, { force: true }).catch(() => undefined);
      }
      if (stagingDirectory) {
        await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined);
      }
    } catch (error) {
      // 逆序回滚，确保依赖同一目录的更新按提交相反顺序恢复。
      for (const item of [...prepared].reverse()) {
        if (item.committed) await rm(item.target, { force: true }).catch(() => undefined);
        if (item.backupMoved && item.backup) {
          try {
            await rename(item.backup, item.target);
            item.backupMoved = false;
          } catch {
            // 恢复失败时保留备份文件，不用后续清理掩盖可人工恢复的原内容。
          }
        }
        if (item.temporary) await rm(item.temporary, { force: true }).catch(() => undefined);
        if (item.backup && !item.backupMoved) {
          await rm(item.backup, { force: true }).catch(() => undefined);
        }
      }
      if (stagingDirectory) {
        await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined);
      }
      throw error;
    }

    return prepared.map(
      ({ status: writeStatus, absolutePath, projectRelativePath, sha256, bytes }) => ({
        status: writeStatus,
        absolutePath,
        projectRelativePath,
        sha256,
        bytes,
      }),
    );
  }
}

function targetConflict(message: string, details?: unknown): BridgeFault {
  return new BridgeFault({
    code: 'EXPORT_TARGET_CONFLICT',
    message,
    retryable: true,
    ...(details === undefined ? {} : { details }),
  });
}

function normalizeRelativePath(value: string): string {
  if (
    !value ||
    value.includes('\0') ||
    isAbsolute(value) ||
    /^(?:[a-zA-Z]:|[\\/]{1,2})/.test(value)
  ) {
    throw invalidPath(value);
  }
  const segments = value.replace(/\\/g, '/').split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw invalidPath(value);
  }
  return segments.join('/');
}

function invalidPath(value: string): BridgeFault {
  return new BridgeFault({
    code: 'EXPORT_PATH_INVALID',
    message: `Export path must be a non-empty workspace-relative path: ${JSON.stringify(value)}`,
    retryable: false,
  });
}

function assertContained(root: string, target: string): void {
  const remaining = relative(root, target);
  if (remaining === '' || (!remaining.startsWith('..') && !isAbsolute(remaining))) return;
  throw invalidPath(target);
}

async function assertNearestExistingParentWithinRoot(root: string, parent: string): Promise<void> {
  let candidate = parent;
  while (true) {
    try {
      const resolved = await realpath(candidate);
      assertContained(root, resolved);
      return;
    } catch (error) {
      if (!isMissing(error)) throw error;
      const next = dirname(candidate);
      if (next === candidate) throw invalidPath(parent);
      candidate = next;
    }
  }
}

async function inspectTarget(target: string): Promise<boolean> {
  try {
    const info = await lstat(target);
    if (info.isSymbolicLink() || !info.isFile()) throw invalidPath(target);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

function digest(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}
