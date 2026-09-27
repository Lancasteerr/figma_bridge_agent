import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createPluginProof, createServerProof } from '../src/ui/auth.js';

describe('Figma UI authentication proofs', () => {
  const secretBytes = Buffer.alloc(32, 7);
  const secret = secretBytes.toString('base64url');
  const serverNonce = 'server-nonce-123456';
  const pluginNonce = 'plugin-nonce-123456';

  it('matches Node HMAC without relying on crypto.subtle', async () => {
    const pluginValue = `figma-agent/plugin/v1|${serverNonce}|${pluginNonce}`;
    const serverValue = `figma-agent/server/v1|${serverNonce}|${pluginNonce}`;

    await expect(createPluginProof(secret, serverNonce, pluginNonce)).resolves.toBe(
      createHmac('sha256', secretBytes).update(pluginValue).digest('base64url'),
    );
    await expect(createServerProof(secret, serverNonce, pluginNonce)).resolves.toBe(
      createHmac('sha256', secretBytes).update(serverValue).digest('base64url'),
    );
  });
});
