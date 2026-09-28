import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createDaemonClientProof,
  createDaemonServerProof,
  createPluginProof,
  createServerProof,
  verifyProof,
} from './proof.js';

describe('mutual authentication proofs', () => {
  // 测试同时覆盖方向隔离、nonce/secret 绑定和 Web Crypto 兼容的 key 解码。
  const secret = Buffer.alloc(32, 7).toString('base64url');
  const serverNonce = 'server-nonce-123456';
  const pluginNonce = 'plugin-nonce-123456';
  const serverId = '11111111-1111-4111-8111-111111111111';
  const deviceId = '22222222-2222-4222-8222-222222222222';

  it('uses direction-specific proofs', () => {
    const plugin = createPluginProof(secret, serverId, deviceId, serverNonce, pluginNonce);
    const server = createServerProof(secret, serverId, deviceId, serverNonce, pluginNonce);
    expect(plugin).not.toBe(server);
    expect(
      verifyProof(plugin, createPluginProof(secret, serverId, deviceId, serverNonce, pluginNonce)),
    ).toBe(true);
  });

  it('separates daemon client proofs from plugin proofs and server proofs', () => {
    const plugin = createPluginProof(secret, serverId, deviceId, serverNonce, pluginNonce);
    const daemonClient = createDaemonClientProof(secret, serverNonce, pluginNonce);
    const daemonServer = createDaemonServerProof(secret, serverNonce, pluginNonce);
    expect(new Set([plugin, daemonClient, daemonServer]).size).toBe(3);
  });

  it('rejects a changed nonce or secret', () => {
    const proof = createPluginProof(secret, serverId, deviceId, serverNonce, pluginNonce);
    expect(
      verifyProof(
        proof,
        createPluginProof(secret, serverId, deviceId, `${serverNonce}x`, pluginNonce),
      ),
    ).toBe(false);
    expect(
      verifyProof(
        proof,
        createPluginProof(`${secret}x`, serverId, deviceId, serverNonce, pluginNonce),
      ),
    ).toBe(false);
  });

  it('uses the decoded 256-bit key shared with Web Crypto', () => {
    const value = `figma-agent/plugin/v2|${serverId}|${deviceId}|${serverNonce}|${pluginNonce}`;
    const expected = createHmac('sha256', Buffer.alloc(32, 7)).update(value).digest('base64url');
    expect(createPluginProof(secret, serverId, deviceId, serverNonce, pluginNonce)).toBe(expected);
  });
});
