import { constants } from 'node:fs';
import { access, mkdir, readdir, realpath, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { isAbsolute, join, parse, relative, resolve } from 'node:path';

import { BridgeFault, type AssetExportStatus } from '@figma-agent/protocol';

const DEFAULT_MAX_STAGED_SESSION_BYTES = 256 * 1024 * 1024;
const FALLBACK_RETENTION_MS = 24 * 60 * 60_000;

export interface SessionWorkspaceOptions {
  homeDirectory?: string;
  sessionId?: string;
  now?: () => number;
  /** 测试可注入 Agent Plugin 的受保护目录；生产环境来自标准环境变量。 */
  pluginRoots?: readonly string[];
  /** 仅供单元测试缩小配额，不从环境变量、CLI 或 MCP 输入读取。 */
  maxStagedSessionBytes?: number;
}

/**
 * 管理单个 stdio Adapter 的目录绑定和暂存配额。
 * 素材与语义快照共享此对象，任意写入开始后都不能再更换工作区根。
 */
export class SessionWorkspace {
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
  #initializePromise?: Promise<void>;

  constructor(options: SessionWorkspaceOptions = {}) {
    this.sessionId = options.sessionId ?? randomUUID();
    this.#homeDirectory = options.homeDirectory ?? homedir();
    this.#now = options.now ?? Date.now;
    this.#pluginRoots = options.pluginRoots ?? capturePluginRoots();
    this.#maxStagedSessionBytes = options.maxStagedSessionBytes ?? DEFAULT_MAX_STAGED_SESSION_BYTES;
  }

  get status(): AssetExportStatus {
    if (!this.#status) throw new Error('SessionWorkspace has not been initialized.');
    return { ...this.#status };
  }

  async initialize(): Promise<void> {
    this.#initializePromise ??= this.#initialize();
    await this.#initializePromise;
  }

  async #initialize(): Promise<void> {
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
      throw exportRootConflict('The staged session has already started writing files.');
    }

    this.#bindingInProgress = true;
    try {
      const workspace = await this.#resolveBindableRoot(rootPath);
      const current = this.status;
      if (current.delivery === 'WORKSPACE') {
        if (samePath(current.rootPath, workspace)) return current;
        throw exportRootConflict('The export root is already bound to another workspace.');
      }
      this.#status = { delivery: 'WORKSPACE', rootPath: workspace, sessionId: this.sessionId };
      return this.status;
    } finally {
      this.#bindingInProgress = false;
    }
  }

  /** 在任何 await 之前冻结写入状态，避免首次写入和根绑定交错。 */
  beginWrite(): AssetExportStatus {
    if (this.#bindingInProgress) {
      throw new BridgeFault({
        code: 'BUSY',
        message: 'The export root is being bound; retry after binding completes.',
        retryable: true,
      });
    }
    this.#writeStarted = true;
    return this.status;
  }

  /** 暂存配额在内存中同步预留，阻止并发写入共同越过会话上限。 */
  reserveStagedBytes(bytes: number): void {
    if (this.status.delivery !== 'STAGED') return;
    if (this.#usedStagedBytes + bytes > this.#maxStagedSessionBytes) {
      throw new BridgeFault({
        code: 'LIMIT_EXCEEDED',
        message: `Staged export quota exceeds ${this.#maxStagedSessionBytes} bytes.`,
        retryable: false,
      });
    }
    this.#usedStagedBytes += bytes;
  }

  releaseStagedBytes(bytes: number): void {
    if (this.status.delivery === 'STAGED') {
      this.#usedStagedBytes = Math.max(0, this.#usedStagedBytes - bytes);
    }
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

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
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
