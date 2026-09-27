import { appendFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

const DEFAULT_MAX_BYTES = 1024 * 1024;

/** 后台进程使用有界 JSONL 日志；串行队列避免并发写入和轮转相互覆盖。 */
export class DaemonLog {
  readonly #path: string;
  readonly #maxBytes: number;
  #bytes = 0;
  #queue: Promise<void> = Promise.resolve();

  constructor(path: string, maxBytes = DEFAULT_MAX_BYTES) {
    this.#path = path;
    this.#maxBytes = maxBytes;
  }

  async initialize(): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    this.#bytes = await stat(this.#path).then((value) => value.size).catch(() => 0);
    if (this.#bytes >= this.#maxBytes) await this.#rotate();
  }

  write(entry: Record<string, unknown>): void {
    const line = `${JSON.stringify({ timestamp: new Date().toISOString(), ...entry })}\n`;
    const bytes = Buffer.byteLength(line);
    this.#queue = this.#queue
      .then(async () => {
        if (this.#bytes + bytes > this.#maxBytes) await this.#rotate();
        await appendFile(this.#path, line, { encoding: 'utf8', mode: 0o600 });
        this.#bytes += bytes;
      })
      .catch(() => undefined);
  }

  async close(): Promise<void> {
    await this.#queue;
  }

  async #rotate(): Promise<void> {
    const previous = `${this.#path}.1`;
    await rm(previous, { force: true });
    await rename(this.#path, previous).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
    this.#bytes = 0;
  }
}
