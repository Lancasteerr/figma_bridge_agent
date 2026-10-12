import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

/** 单次 MCP 服务进程允许写入临时目录的总容量。 */
export const MAX_TEMP_SESSION_BYTES = 256 * 1024 * 1024;
/** 临时产物固定保留三十分钟。 */
export const TEMP_ARTIFACT_TTL_MS = 30 * 60_000;
/** 运行期间每分钟主动清理一次过期产物。 */
export const TEMP_ARTIFACT_SWEEP_INTERVAL_MS = 60_000;

/** 临时产物的本地路径、摘要和生命周期信息。 */
export interface StoredArtifact {
  localPath: string;
  sha256: string;
  bytes: number;
  createdAt: string;
  expiresAt: string;
}

interface TemporaryArtifactStoreOptions {
  baseDirectory?: string;
  maxSessionBytes?: number;
  now?: () => number;
  sweepIntervalMs?: number;
  ttlMs?: number;
}

interface ActiveArtifact {
  bytes: number;
  expiresAtMs: number;
}

/**
 * 为每次 MCP 服务运行创建隔离目录，并统一管理图片和 JSONL 等短期产物。
 * 历史会话按文件修改时间恢复过期时间，不依赖可能损坏的额外清单文件。
 */
export class TemporaryArtifactStore {
  readonly root: string;
  readonly baseDirectory: string;
  readonly #maxSessionBytes: number;
  readonly #now: () => number;
  readonly #sweepIntervalMs: number;
  readonly #ttlMs: number;
  readonly #active = new Map<string, ActiveArtifact>();
  #usedBytes = 0;
  #timer: NodeJS.Timeout | undefined;
  #sweepPromise: Promise<void> | undefined;
  #initialized = false;

  constructor(options: TemporaryArtifactStoreOptions = {}) {
    this.baseDirectory = options.baseDirectory ?? join(tmpdir(), 'figma-agent-mcp');
    this.root = join(this.baseDirectory, randomUUID());
    this.#maxSessionBytes = options.maxSessionBytes ?? MAX_TEMP_SESSION_BYTES;
    this.#now = options.now ?? Date.now;
    this.#sweepIntervalMs = options.sweepIntervalMs ?? TEMP_ARTIFACT_SWEEP_INTERVAL_MS;
    this.#ttlMs = options.ttlMs ?? TEMP_ARTIFACT_TTL_MS;
  }

  async initialize(): Promise<void> {
    if (this.#initialized) return;
    await mkdir(this.baseDirectory, { recursive: true });
    await this.sweepExpired();
    await mkdir(this.root, { recursive: true });
    this.#timer = setInterval(() => {
      void this.sweepExpired().catch((error: unknown) => {
        console.error(
          JSON.stringify({
            level: 'warn',
            message: 'Temporary artifact cleanup failed.',
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      });
    }, this.#sweepIntervalMs);
    this.#timer.unref();
    this.#initialized = true;
  }

  /** 在本次会话配额内原子写入产物，并返回可供 Agent 审查的本地文件信息。 */
  async write(name: string, data: Uint8Array | string): Promise<StoredArtifact> {
    if (!this.#initialized) throw new Error('Temporary artifact store is not initialized.');
    await this.sweepExpired();
    const bytes = typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
    if (this.#usedBytes + bytes > this.#maxSessionBytes) {
      throw new Error(`Temporary artifact quota exceeded (${this.#maxSessionBytes} bytes).`);
    }
    // 在第一次异步写入前预留容量，避免并发 write 同时通过配额检查。
    this.#usedBytes += bytes;

    const safeName = sanitizeArtifactName(name);
    const target = join(this.root, `${randomUUID()}-${safeName}`);
    const temporary = `${target}.tmp`;
    const createdAtMs = this.#now();
    const expiresAtMs = createdAtMs + this.#ttlMs;
    try {
      await writeFile(temporary, data);
      await rename(temporary, target);
    } catch (error) {
      this.#usedBytes = Math.max(0, this.#usedBytes - bytes);
      await rm(temporary, { force: true });
      throw error;
    }

    this.#active.set(target, { bytes, expiresAtMs });
    return {
      localPath: target,
      sha256: createHash('sha256').update(data).digest('hex'),
      bytes,
      createdAt: new Date(createdAtMs).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  /** 删除当前和历史会话中已经过期的文件，并回收当前会话配额。 */
  async sweepExpired(): Promise<void> {
    this.#sweepPromise ??= this.#performSweep().finally(() => {
      this.#sweepPromise = undefined;
    });
    await this.#sweepPromise;
  }

  async #performSweep(): Promise<void> {
    const now = this.#now();
    await mkdir(this.baseDirectory, { recursive: true });
    const sessions = await readdir(this.baseDirectory, { withFileTypes: true });
    for (const session of sessions) {
      if (!session.isDirectory()) continue;
      const sessionPath = join(this.baseDirectory, session.name);
      const entries = await readdir(sessionPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const path = join(sessionPath, entry.name);
        const active = this.#active.get(path);
        const expiresAtMs = active?.expiresAtMs ?? (await stat(path)).mtimeMs + this.#ttlMs;
        if (expiresAtMs > now) continue;
        await this.#removeFile(path, active?.bytes ?? 0);
      }
      if (sessionPath !== this.root && (await readdir(sessionPath)).length === 0) {
        await this.#removeDirectory(sessionPath);
      }
    }
  }

  /** 正常关闭时立即清理本会话产物，避免短期文件滞留。 */
  async close(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
    if (this.#sweepPromise) await this.#sweepPromise.catch(() => undefined);
    if (this.#initialized) await this.#removeDirectory(this.root);
    this.#active.clear();
    this.#usedBytes = 0;
    this.#initialized = false;
  }

  async #removeFile(path: string, bytes: number): Promise<void> {
    await assertWithinBase(path, this.baseDirectory);
    await rm(path, { force: true });
    if (this.#active.delete(path)) this.#usedBytes = Math.max(0, this.#usedBytes - bytes);
  }

  async #removeDirectory(path: string): Promise<void> {
    await assertWithinBase(path, this.baseDirectory);
    await rm(path, { recursive: true, force: true });
  }
}

/** 将外部建议文件名限制为安全、短且不含路径分隔符的 basename。 */
export function sanitizeArtifactName(value: string): string {
  const sanitized = value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  return sanitized || 'artifact';
}

/** 删除前同时检查词法路径和真实路径，阻止越过专属临时根目录。 */
async function assertWithinBase(path: string, baseDirectory: string): Promise<void> {
  const resolvedBase = resolve(baseDirectory);
  const resolvedPath = resolve(path);
  const lexical = relative(resolvedBase, resolvedPath);
  if (!lexical || lexical.startsWith('..') || isAbsolute(lexical)) {
    throw new Error('Temporary artifact path is outside its managed root.');
  }

  const [realBase, realTarget] = await Promise.all([
    realpath(resolvedBase),
    realpath(resolvedPath),
  ]);
  const physical = relative(realBase, realTarget);
  if (!physical || physical.startsWith('..') || isAbsolute(physical)) {
    throw new Error('Temporary artifact path resolves outside its managed root.');
  }
}
