import { describe, expect, it } from 'vitest';

import { createPluginProof, createServerProof, verifyProof } from './proof.js';

describe('mutual authentication proofs', () => {
  const secret = 'secret-that-is-long-enough-for-tests';
  const serverNonce = 'server-nonce-123456';
  const pluginNonce = 'plugin-nonce-123456';

  it('uses direction-specific proofs', () => {
    const plugin = createPluginProof(secret, serverNonce, pluginNonce);
    const server = createServerProof(secret, serverNonce, pluginNonce);
    expect(plugin).not.toBe(server);
    expect(verifyProof(plugin, createPluginProof(secret, serverNonce, pluginNonce))).toBe(true);
  });

  it('rejects a changed nonce or secret', () => {
    const proof = createPluginProof(secret, serverNonce, pluginNonce);
    expect(verifyProof(proof, createPluginProof(secret, `${serverNonce}x`, pluginNonce))).toBe(false);
    expect(verifyProof(proof, createPluginProof(`${secret}x`, serverNonce, pluginNonce))).toBe(false);
  });
});

