import {
  BridgeFault,
  type StageAssetRpcInput,
  type StagedAssetResult,
} from '@figma-agent/protocol';

const ASSET_TTL_MS = 10 * 60_000;
const MAX_CACHE_BYTES = 32 * 1024 * 1024;

export type StagedAssetEntry = StageAssetRpcInput & {
  expiresAtMs: number;
  rasterBytes?: Uint8Array;
};

/** 素材只在当前插件连接内存中暂存，不写入用户项目或本地持久化存储。 */
export class AssetCache {
  readonly #entries = new Map<string, StagedAssetEntry>();
  readonly #bySha = new Map<string, string>();
  #usedBytes = 0;

  put(input: StageAssetRpcInput): StagedAssetResult {
    this.prune();
    const duplicateId = this.#bySha.get(input.sha256);
    const duplicate = duplicateId ? this.#entries.get(duplicateId) : undefined;
    if (duplicate) return this.result(duplicate);
    if (this.#usedBytes + input.bytes > MAX_CACHE_BYTES) {
      throw new BridgeFault({
        code: 'PAYLOAD_TOO_LARGE',
        message: `Staged asset cache exceeds ${MAX_CACHE_BYTES} bytes.`,
        retryable: true,
      });
    }
    const entry: StagedAssetEntry = {
      ...input,
      expiresAtMs: Date.now() + ASSET_TTL_MS,
      ...(input.kind === 'RASTER' && input.dataBase64
        ? { rasterBytes: figma.base64Decode(input.dataBase64) }
        : {}),
    };
    if (entry.kind === 'RASTER' && entry.rasterBytes?.byteLength !== entry.bytes) {
      throw invalid('Raster byte length changed during transport.');
    }
    if (entry.kind === 'SVG' && !entry.svgText) throw invalid('SVG text is missing.');
    this.#entries.set(entry.assetId, entry);
    this.#bySha.set(entry.sha256, entry.assetId);
    this.#usedBytes += entry.bytes;
    return this.result(entry);
  }

  get(assetId: string, sha256: string): StagedAssetEntry {
    const entry = this.#entries.get(assetId);
    if (!entry) {
      throw new BridgeFault({
        code: 'ASSET_NOT_FOUND',
        message: `Staged asset ${assetId} is unavailable in this plugin connection.`,
        retryable: true,
      });
    }
    if (entry.expiresAtMs <= Date.now()) {
      this.delete(entry);
      throw new BridgeFault({
        code: 'ASSET_EXPIRED',
        message: `Staged asset ${assetId} has expired.`,
        retryable: true,
      });
    }
    if (entry.sha256 !== sha256) throw invalid(`Staged asset ${assetId} digest does not match.`);
    return entry;
  }

  clear(): void {
    this.#entries.clear();
    this.#bySha.clear();
    this.#usedBytes = 0;
  }

  private prune(): void {
    const now = Date.now();
    for (const entry of this.#entries.values()) {
      if (entry.expiresAtMs <= now) this.delete(entry);
    }
  }

  private delete(entry: StagedAssetEntry): void {
    this.#entries.delete(entry.assetId);
    if (this.#bySha.get(entry.sha256) === entry.assetId) this.#bySha.delete(entry.sha256);
    this.#usedBytes -= entry.bytes;
  }

  private result(entry: StagedAssetEntry): StagedAssetResult {
    return {
      assetId: entry.assetId,
      kind: entry.kind,
      mimeType: entry.mimeType,
      sha256: entry.sha256,
      bytes: entry.bytes,
      ...(entry.width ? { width: entry.width } : {}),
      ...(entry.height ? { height: entry.height } : {}),
      expiresAt: new Date(entry.expiresAtMs).toISOString(),
    };
  }
}

function invalid(message: string): BridgeFault {
  return new BridgeFault({ code: 'INVALID_ASSET', message, retryable: false });
}

export const assetCache = new AssetCache();
