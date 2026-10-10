import { constants } from 'node:fs';
import {
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

import { BridgeFault } from '@figma-agent/protocol';

const MAX_STAGED_SESSION_BYTES = 256 * 1024 * 1024;
const FALLBACK_RETENTION_MS = 24 * 60 * 60_000;

export interface AssetExportStatus {
  delivery: 'WORKSPACE' | 'STAGED';
  rootPath: string;
  sessionId: string;
  fallbackExpiresAt?: string;
}

export interface ExportWriteRequest {
  relativePath: string;
  data: Uint8Array | string;
  writePolicy: 'REUSE_OR_FAIL' | 'OVERWRITE';
  expectedExistingSha256?: string;
}

export interface ExportWriteResult {
  status: 'CREATED' | 'REUSED' | 'UPDATED';
  absolutePath: string;
  projectRelativePath: string;
  sha256: string;
  bytes: number;
}

export interface ExportStoreOptions {
  /** 测试可注入启动目录；生产环境必须使用构造时捕获的 process.cwd()。 */
  cwd?: string | null;
  homeDirectory?: string;
  sessionId?: string;
  now?: () => number;
  /** 仅供单元测试缩小配额，不从环境变量、CLI 或 MCP 输入读取。 */
  maxStagedSessionBytes?: number;
}

/**
 * 每个 stdio Server 独享一个导出根；初始化后根目录不会因单次写入失败而改变。
 */
export class ExportStore {
  readonly sessionId: string;
  readonly #capturedCwd: string | null;
  readonly #homeDirectory: string;
  readonly #now: () => number;
  readonly #maxStagedSessionBytes: number;
  #status?: AssetExportStatus;
  #usedStagedBytes = 0;

  constructor(options: ExportStoreOptions = {}) {
    this.sessionId = options.sessionId ?? randomUUID();
    this.#capturedCwd = options.cwd === undefined ? captureProcessCwd() : options.cwd;
    this.#homeDirectory = options.homeDirectory ?? homedir();
    this.#now = options.now ?? Date.now;
    this.#maxStagedSessionBytes = options.maxStagedSessionBytes ?? MAX_STAGED_SESSION_BYTES;
  }

  get status(): AssetExportStatus {
    if (!this.#status) throw new Error('ExportStore has not been initialized.');
    return { ...this.#status };
  }

  async initialize(): Promise<void> {
    const fallbackBase = join(this.#homeDirectory, 'figma_bridge_agent_export');
    await cleanupStaleFallbackSessions(fallbackBase, this.#now());

    const workspace = await resolveWritableDirectory(this.#capturedCwd);
    if (workspace) {
      this.#status = {
        delivery: 'WORKSPACE',
        rootPath: workspace,
        sessionId: this.sessionId,
      };
      return;
    }

    const fallbackRoot = join(fallbackBase, this.sessionId);
    await mkdir(fallbackRoot, { recursive: true });
    this.#status = {
      delivery: 'STAGED',
      rootPath: await realpath(fallbackRoot),
      sessionId: this.sessionId,
      fallbackExpiresAt: new Date(this.#now() + FALLBACK_RETENTION_MS).toISOString(),
    };
  }

  /** 校验边界后以同目录临时文件和 rename 原子提交素材。 */
  async write(request: ExportWriteRequest): Promise<ExportWriteResult> {
    const status = this.status;
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
        return {
          status: 'REUSED',
          absolutePath: target,
          projectRelativePath,
          sha256,
          bytes,
        };
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

    if (
      status.delivery === 'STAGED' &&
      this.#usedStagedBytes + bytes > this.#maxStagedSessionBytes
    ) {
      throw new BridgeFault({
        code: 'LIMIT_EXCEEDED',
        message: `Staged export quota exceeds ${this.#maxStagedSessionBytes} bytes.`,
        retryable: false,
      });
    }

    const temporary = join(parent, `.${randomUUID()}.figma-export.tmp`);
    try {
      await writeFile(temporary, data, { flag: 'wx' });
      // 覆盖前再读取一次目标摘要，防止检查后到 rename 前发生并发修改。
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

    if (status.delivery === 'STAGED') this.#usedStagedBytes += bytes;
    return {
      status: existing ? 'UPDATED' : 'CREATED',
      absolutePath: target,
      projectRelativePath,
      sha256,
      bytes,
    };
  }
}

function captureProcessCwd(): string | null {
  try {
    return process.cwd();
  } catch {
    return null;
  }
}

async function resolveWritableDirectory(candidate: string | null): Promise<string | null> {
  if (!candidate) return null;
  try {
    const info = await stat(candidate);
    if (!info.isDirectory()) return null;
    const resolved = await realpath(candidate);
    await access(resolved, constants.W_OK);
    return resolved;
  } catch {
    return null;
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

async function inspectTarget(target: string): Promise<true | false> {
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

async function cleanupStaleFallbackSessions(baseDirectory: string, now: number): Promise<void> {
  let entries;
  try {
    entries = await readdir(baseDirectory, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const path = join(baseDirectory, entry.name);
        const info = await stat(path);
        if (now - info.mtimeMs > FALLBACK_RETENTION_MS) {
          await rm(path, { recursive: true, force: true });
        }
      }),
  );
}
