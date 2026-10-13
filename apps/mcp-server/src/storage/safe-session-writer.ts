import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
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
