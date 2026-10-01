import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AssetCache } from '../src/main/assets/asset-cache.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-02T00:00:00.000Z'));
  vi.stubGlobal('figma', {
    base64Decode: (value: string) => new Uint8Array(Buffer.from(value, 'base64')),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('plugin staged asset cache', () => {
  it('deduplicates assets by digest and clears them on disconnect', () => {
    const cache = new AssetCache();
    const first = cache.put(rasterInput('11111111-1111-4111-8111-111111111111'));
    const second = cache.put(rasterInput('22222222-2222-4222-8222-222222222222'));

    expect(second.assetId).toBe(first.assetId);
    cache.clear();
    expect(() => cache.get(first.assetId, first.sha256)).toThrowError();
  });

  it('expires entries after ten minutes', () => {
    const cache = new AssetCache();
    const result = cache.put(rasterInput('11111111-1111-4111-8111-111111111111'));
    vi.advanceTimersByTime(10 * 60_000 + 1);

    expect(() => cache.get(result.assetId, result.sha256)).toThrowError();
  });
});

function rasterInput(assetId: string) {
  return {
    assetId,
    name: 'pixel.png',
    kind: 'RASTER' as const,
    mimeType: 'image/png' as const,
    sha256: 'a'.repeat(64),
    bytes: 1,
    width: 1,
    height: 1,
    dataBase64: 'AA==',
  };
}
