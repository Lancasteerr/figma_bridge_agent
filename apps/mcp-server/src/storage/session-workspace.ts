import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, parse, relative, resolve } from 'node:path';

import { BridgeFault, type WorkspaceStatus } from '@figma-agent/protocol';

export interface SessionWorkspaceOptions {
  homeDirectory?: string;
  sessionId?: string;
  /** 测试可注入 Agent Plugin 的受保护目录；生产环境来自标准环境变量。 */
  pluginRoots?: readonly string[];
}

export type BoundWorkspaceStatus = Extract<WorkspaceStatus, { state: 'BOUND' }>;

/**
 * 管理单个 stdio Adapter 的一次性工作区绑定。
 * 持久写入不再提供暂存目录，未绑定时必须显式失败。
 */
export class SessionWorkspace {
  readonly sessionId: string;
  readonly #homeDirectory: string;
  readonly #pluginRoots: readonly string[];
  #status: WorkspaceStatus;
  #bindingInProgress = false;

  constructor(options: SessionWorkspaceOptions = {}) {
    this.sessionId = options.sessionId ?? randomUUID();
    this.#homeDirectory = options.homeDirectory ?? homedir();
    this.#pluginRoots = options.pluginRoots ?? capturePluginRoots();
    this.#status = { state: 'UNBOUND', sessionId: this.sessionId };
  }

  get status(): WorkspaceStatus {
    return { ...this.#status };
  }

  /** 保留异步初始化入口，方便服务器与临时产物存储统一启动。 */
  initialize(): Promise<void> {
    return Promise.resolve();
  }

  /** 将 Agent 明确提供的工作区根一次性绑定到当前 stdio 会话。 */
  async bindRoot(rootPath: string, expectedSessionId: string): Promise<BoundWorkspaceStatus> {
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

    this.#bindingInProgress = true;
    try {
      const workspace = await this.#resolveBindableRoot(rootPath);
      const current = this.#status;
      if (current.state === 'BOUND') {
        if (samePath(current.rootPath, workspace)) return { ...current };
        throw exportRootConflict('The export root is already bound to another workspace.');
      }
      this.#status = { state: 'BOUND', rootPath: workspace, sessionId: this.sessionId };
      return { ...this.#status };
    } finally {
      this.#bindingInProgress = false;
    }
  }

  /** 持久写入只能使用已经确认的工作区根，避免产生无人复制的暂存文件。 */
  beginWrite(): BoundWorkspaceStatus {
    if (this.#bindingInProgress) {
      throw new BridgeFault({
        code: 'BUSY',
        message: 'The export root is being bound; retry after binding completes.',
        retryable: true,
      });
    }
    if (this.#status.state === 'UNBOUND') {
      throw new BridgeFault({
        code: 'EXPORT_ROOT_UNBOUND',
        message:
          'Bind the current workspace with figma_frontend_bind_workspace before writing files.',
        retryable: true,
      });
    }
    return { ...this.#status };
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

    for (const protectedRoot of this.#pluginRoots) {
      const canonical = await realpath(protectedRoot).catch(() => resolve(protectedRoot));
      if (isSameOrContained(canonical, resolved)) {
        throw invalidExportRoot(candidate, 'Plugin directories cannot be export roots.');
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
