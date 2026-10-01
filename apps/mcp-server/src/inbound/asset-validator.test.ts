import { describe, expect, it } from 'vitest';

import { validateInboundAsset } from './asset-validator.js';

const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('inbound design asset validation', () => {
  it('accepts a canonical PNG and records its actual dimensions', async () => {
    await expect(
      validateInboundAsset({ name: 'pixel.png', mimeType: 'image/png', dataBase64: PNG_1X1 }),
    ).resolves.toMatchObject({ kind: 'RASTER', width: 1, height: 1, bytes: 68 });
  });

  it('rejects a declared MIME that disagrees with the file signature', async () => {
    await expect(
      validateInboundAsset({ name: 'pixel.jpg', mimeType: 'image/jpeg', dataBase64: PNG_1X1 }),
    ).rejects.toMatchObject({ bridgeError: { code: 'INVALID_ASSET' } });
  });

  it('normalizes a safe SVG and rejects scripts and external references', async () => {
    const safe = await validateInboundAsset({
      name: 'icon.svg',
      mimeType: 'image/svg+xml',
      dataBase64: encode(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24z"/></svg>',
      ),
    });
    expect(safe).toMatchObject({ kind: 'SVG', width: 24, height: 24 });

    await expect(
      validateInboundAsset({
        name: 'bad.svg',
        mimeType: 'image/svg+xml',
        dataBase64: encode(
          '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>',
        ),
      }),
    ).rejects.toMatchObject({ bridgeError: { code: 'INVALID_ASSET' } });

    await expect(
      validateInboundAsset({
        name: 'external.svg',
        mimeType: 'image/svg+xml',
        dataBase64: encode(
          '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><image href="https://example.com/a.png"/></svg>',
        ),
      }),
    ).rejects.toMatchObject({ bridgeError: { code: 'INVALID_ASSET' } });
  });

  it('rejects non-canonical Base64', async () => {
    await expect(
      validateInboundAsset({ name: 'bad.png', mimeType: 'image/png', dataBase64: `${PNG_1X1}\n` }),
    ).rejects.toMatchObject({ bridgeError: { code: 'INVALID_ASSET' } });
  });
});

function encode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}
