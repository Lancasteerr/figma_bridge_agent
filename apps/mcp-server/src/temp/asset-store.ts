import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** 单次 MCP 服务进程允许写入临时目录的总容量。 */
const MAX_SESSION_BYTES = 256 * 1024 * 1024;
/** 服务重启后清理超过一天未更新的历史会话目录。 */
const STALE_AFTER_MS = 24 * 60 * 60_000;

/** 临时资源的本地路径、摘要和字节数，供 MCP 返回可审查的文件信息。 */
export interface StoredAsset {
  localPath: string;
  sha256: string;
  bytes: number;
}

/**
 * 每次服务运行使用独立 UUID 目录，并通过临时文件 rename 保证写入结果完整。
 */
export class TempAssetStore {
  readonly root: string;
  #usedBytes = 0;

  constructor(baseDirectory = join(tmpdir(), 'figma-agent-mcp')) {
    this.root = join(baseDirectory, randomUUID());
    this.baseDirectory = baseDirectory;
  }

  private readonly baseDirectory: string;

  async initialize(): Promise<void> {
    await mkdir(this.baseDirectory, { recursive: true });
    await this.cleanupStale();
    await mkdir(this.root, { recursive: true });
  }

  /** 在本次会话配额内写入资源，并返回 SHA-256 供调用方校验内容。 */
  async write(name: string, data: Uint8Array | string): Promise<StoredAsset> {
    const bytes = typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
    if (this.#usedBytes + bytes > MAX_SESSION_BYTES) {
      throw new Error(`Temporary asset quota exceeded (${MAX_SESSION_BYTES} bytes).`);
    }
    const safeName = sanitizeName(name);
    const target = join(this.root, `${randomUUID()}-${safeName}`);
    const temporary = `${target}.tmp`;
    await writeFile(temporary, data);
    await rename(temporary, target);
    this.#usedBytes += bytes;
    return {
      localPath: target,
      sha256: createHash('sha256').update(data).digest('hex'),
      bytes,
    };
  }

  /** 关闭服务时删除当前会话目录；历史目录由 initialize 的清理逻辑处理。 */
  async close(): Promise<void> {
    await rm(this.root, { recursive: true, force: true });
  }

  private async cleanupStale(): Promise<void> {
    const now = Date.now();
    const entries = await readdir(this.baseDirectory, { withFileTypes: true });
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const path = join(this.baseDirectory, entry.name);
          const info = await stat(path);
          if (now - info.mtimeMs > STALE_AFTER_MS) {
            await rm(path, { recursive: true, force: true });
          }
        }),
    );
  }
}

/** 将外部建议文件名限制为安全、短且不含路径分隔符的 basename。 */
export function sanitizeName(value: string): string {
  const sanitized = value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  return sanitized || 'asset';
}
