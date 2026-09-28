import { describe, expect, it } from 'vitest';

import { derivePairingMaterial, pairingTranscript, x25519 } from './pairing.js';

describe('pairing key derivation', () => {
  it('derives the same SAS, token and confirmation proof on both sides', () => {
    const serverPrivate = Uint8Array.from({ length: 32 }, (_value, index) => index + 1);
    const pluginPrivate = Uint8Array.from({ length: 32 }, (_value, index) => 64 - index);
    const transcript = pairingTranscript({
      serverId: '11111111-1111-4111-8111-111111111111',
      sessionId: '33333333-3333-4333-8333-333333333333',
      serverNonce: 'server-nonce-1234567890',
      serverPublicKey: Buffer.from(x25519.getPublicKey(serverPrivate)).toString('base64url'),
      deviceId: '22222222-2222-4222-8222-222222222222',
      pluginNonce: 'plugin-nonce-1234567890',
      pluginPublicKey: Buffer.from(x25519.getPublicKey(pluginPrivate)).toString('base64url'),
    });
    const server = derivePairingMaterial(
      serverPrivate,
      x25519.getPublicKey(pluginPrivate),
      transcript,
    );
    const plugin = derivePairingMaterial(
      pluginPrivate,
      x25519.getPublicKey(serverPrivate),
      transcript,
    );

    expect(server.sas).toMatch(/^\d{6}$/);
    expect(Buffer.from(server.token)).toEqual(Buffer.from(plugin.token));
    expect(Buffer.from(server.confirmationProof)).toEqual(Buffer.from(plugin.confirmationProof));
  });

  it('changes every derived value when the device identity changes', () => {
    const serverPrivate = new Uint8Array(32).fill(7);
    const pluginPrivate = new Uint8Array(32).fill(9);
    const base = {
      serverId: '11111111-1111-4111-8111-111111111111',
      sessionId: '33333333-3333-4333-8333-333333333333',
      serverNonce: 'server-nonce-1234567890',
      serverPublicKey: Buffer.from(x25519.getPublicKey(serverPrivate)).toString('base64url'),
      pluginNonce: 'plugin-nonce-1234567890',
      pluginPublicKey: Buffer.from(x25519.getPublicKey(pluginPrivate)).toString('base64url'),
    };
    const first = derivePairingMaterial(
      serverPrivate,
      x25519.getPublicKey(pluginPrivate),
      pairingTranscript({ ...base, deviceId: '22222222-2222-4222-8222-222222222222' }),
    );
    const second = derivePairingMaterial(
      serverPrivate,
      x25519.getPublicKey(pluginPrivate),
      pairingTranscript({ ...base, deviceId: '44444444-4444-4444-8444-444444444444' }),
    );
    expect(Buffer.from(first.token)).not.toEqual(Buffer.from(second.token));
    expect(Buffer.from(first.confirmationProof)).not.toEqual(Buffer.from(second.confirmationProof));
  });
});
