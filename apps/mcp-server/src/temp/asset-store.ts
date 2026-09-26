import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MAX_SESSION_BYTES = 256 * 1024 * 1024;
const STALE_AFTER_MS = 24 * 60 * 60_000;

export interface StoredAsset {
  localPath: string;
  sha256: string;
  bytes: number;
}

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

export function sanitizeName(value: string): string {
  const sanitized = value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  return sanitized || 'asset';
}
