import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createPluginProof, createServerProof } from '../src/ui/auth.js';

describe('Figma UI authentication proofs', () => {
  const secretBytes = Buffer.alloc(32, 7);
  const secret = secretBytes.toString('base64url');
  const serverNonce = 'server-nonce-123456';
  const pluginNonce = 'plugin-nonce-123456';
  const serverId = '11111111-1111-4111-8111-111111111111';
  const deviceId = '22222222-2222-4222-8222-222222222222';

  it('matches Node HMAC without relying on crypto.subtle', () => {
    const pluginValue = `figma-agent/plugin/v2|${serverId}|${deviceId}|${serverNonce}|${pluginNonce}`;
    const serverValue = `figma-agent/server/v2|${serverId}|${deviceId}|${serverNonce}|${pluginNonce}`;

    expect(createPluginProof(secret, serverId, deviceId, serverNonce, pluginNonce)).toBe(
      createHmac('sha256', secretBytes).update(pluginValue).digest('base64url'),
    );
    expect(createServerProof(secret, serverId, deviceId, serverNonce, pluginNonce)).toBe(
      createHmac('sha256', secretBytes).update(serverValue).digest('base64url'),
    );
  });
});
