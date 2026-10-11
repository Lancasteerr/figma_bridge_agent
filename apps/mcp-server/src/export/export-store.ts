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
import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

import { BridgeFault, type AssetExportStatus } from '@figma-agent/protocol';

const MAX_STAGED_SESSION_BYTES = 256 * 1024 * 1024;
const FALLBACK_RETENTION_MS = 24 * 60 * 60_000;

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
  homeDirectory?: string;
  sessionId?: string;
  now?: () => number;
  /** 测试可注入 Agent Plugin 的受保护目录；生产环境来自标准环境变量。 */
  pluginRoots?: readonly string[];
  /** 仅供单元测试缩小配额，不从环境变量、CLI 或 MCP 输入读取。 */
  maxStagedSessionBytes?: number;
}

/**
 * 每个 stdio Server 独享一个导出根；初始化后根目录不会因单次写入失败而改变。
 */
export class ExportStore {
  readonly sessionId: string;
  readonly #homeDirectory: string;
  readonly #now: () => number;
  readonly #pluginRoots: readonly string[];
  readonly #maxStagedSessionBytes: number;
  #status?: AssetExportStatus;
  #fallbackBase?: string;
  #usedStagedBytes = 0;
  #writeStarted = false;
  #bindingInProgress = false;

  constructor(options: ExportStoreOptions = {}) {
    this.sessionId = options.sessionId ?? randomUUID();
    this.#homeDirectory = options.homeDirectory ?? homedir();
    this.#now = options.now ?? Date.now;
    this.#pluginRoots = options.pluginRoots ?? capturePluginRoots();
    this.#maxStagedSessionBytes = options.maxStagedSessionBytes ?? MAX_STAGED_SESSION_BYTES;
  }

  get status(): AssetExportStatus {
    if (!this.#status) throw new Error('ExportStore has not been initialized.');
    return { ...this.#status };
  }

  async initialize(): Promise<void> {
    const fallbackBase = join(this.#homeDirectory, 'figma_bridge_agent_export');
    this.#fallbackBase = fallbackBase;
    await cleanupStaleFallbackSessions(fallbackBase, this.#now());
    const fallbackRoot = join(fallbackBase, this.sessionId);
    await mkdir(fallbackRoot, { recursive: true });
    this.#status = {
      delivery: 'STAGED',
      rootPath: await realpath(fallbackRoot),
      sessionId: this.sessionId,
      fallbackExpiresAt: new Date(this.#now() + FALLBACK_RETENTION_MS).toISOString(),
    };
  }

  /** 将 Agent 明确提供的工作区根一次性绑定到当前 stdio 会话。 */
  async bindRoot(rootPath: string, expectedSessionId: string): Promise<AssetExportStatus> {
    if (expectedSessionId !== this.sessionId) {
      throw new BridgeFault({
        code: 'EXPORT_SESSION_MISMATCH',
        message: 'Export session changed; call figma_status and bind the current session.',
        retryable: true,
        details: { expectedSessionId, actualSessionId: this.sessionId },
      });
    }
    if (this.#bindingInProgress) {
      throw new BridgeFault({
        code: 'BUSY',
        message: 'Another export-root binding is already in progress.',
        retryable: true,
      });
    }
    if (this.status.delivery === 'STAGED' && this.#writeStarted) {
      throw exportRootConflict('The staged session has already started exporting files.');
    }

    this.#bindingInProgress = true;
    try {
      const workspace = await this.#resolveBindableRoot(rootPath);
      const current = this.status;
      if (current.delivery === 'WORKSPACE') {
        if (samePath(current.rootPath, workspace)) return current;
        throw exportRootConflict('The export root is already bound to another workspace.');
      }
      this.#status = {
        delivery: 'WORKSPACE',
        rootPath: workspace,
        sessionId: this.sessionId,
      };
      return this.status;
    } finally {
      this.#bindingInProgress = false;
    }
  }

  /** 校验边界后以同目录临时文件和 rename 原子提交素材。 */
  async write(request: ExportWriteRequest): Promise<ExportWriteResult> {
    if (this.#bindingInProgress) {
      throw new BridgeFault({
        code: 'BUSY',
        message: 'The export root is being bound; retry the export after binding completes.',
        retryable: true,
      });
    }
    // 同步冻结写入已开始状态，防止绑定与首次写入在 await 边界交错。
    this.#writeStarted = true;
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

  async #resolveBindableRoot(candidate: string): Promise<string> {
    if (!candidate || candidate.includes('\0') || !isAbsolute(candidate)) {
      throw invalidExportRoot(candidate, 'Export root must be an absolute local path.');
    }
    let resolved: string;
    try {
      const info = await stat(candidate);
      if (!info.isDirectory()) {
        throw invalidExportRoot(candidate, 'Export root must resolve to a directory.');
      }
      resolved = await realpath(candidate);
      await access(resolved, constants.W_OK);
    } catch (error) {
      if (error instanceof BridgeFault) throw error;
      throw invalidExportRoot(candidate, 'Export root must exist and be writable.');
    }

    if (samePath(parse(resolved).root, resolved)) {
      throw invalidExportRoot(candidate, 'Filesystem roots cannot be bound as export roots.');
    }
    const resolvedHome = await realpath(this.#homeDirectory).catch(() =>
      resolve(this.#homeDirectory),
    );
    if (samePath(resolvedHome, resolved)) {
      throw invalidExportRoot(
        candidate,
        'The user home directory cannot be bound as an export root.',
      );
    }

    const protectedRoots = [this.#fallbackBase, ...this.#pluginRoots].filter(
      (value): value is string => Boolean(value),
    );
    for (const protectedRoot of protectedRoots) {
      const canonical = await realpath(protectedRoot).catch(() => resolve(protectedRoot));
      if (isSameOrContained(canonical, resolved)) {
        throw invalidExportRoot(
          candidate,
          'Plugin and staging directories cannot be export roots.',
        );
      }
    }
    return resolved;
  }
}

function capturePluginRoots(): string[] {
  return [process.env.PLUGIN_ROOT, process.env.PLUGIN_DATA].filter((value): value is string =>
    Boolean(value),
  );
}

function invalidExportRoot(rootPath: string, message: string): BridgeFault {
  return new BridgeFault({
    code: 'EXPORT_ROOT_INVALID',
    message,
    retryable: false,
    details: { rootPath },
  });
}

function exportRootConflict(message: string): BridgeFault {
  return new BridgeFault({ code: 'EXPORT_ROOT_CONFLICT', message, retryable: false });
}

function samePath(first: string, second: string): boolean {
  return relative(first, second) === '';
}

function isSameOrContained(root: string, target: string): boolean {
  const remaining = relative(root, target);
  return remaining === '' || (!remaining.startsWith('..') && !isAbsolute(remaining));
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
