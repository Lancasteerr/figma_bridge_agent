import { MAX_PAIRED_CLIENTS, PAIRING_SESSION_TTL_MS } from '@figma-agent/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ServerConfig } from '../config/store.js';
import { PairingManager } from './pairing-manager.js';

afterEach(() => vi.useRealTimers());

describe('PairingManager lifecycle', () => {
  it('expires a session after the fixed 120-second window', () => {
    vi.useFakeTimers();
    const manager = new PairingManager(testConfig());
    expect(manager.start()).toMatchObject({ state: 'waiting-plugin' });
    vi.advanceTimersByTime(PAIRING_SESSION_TTL_MS);
    expect(manager.status).toEqual({ state: 'expired' });
  });

  it('cancels without leaving an active session', () => {
    const manager = new PairingManager(testConfig());
    manager.start();
    expect(manager.cancel()).toEqual({ state: 'cancelled' });
    expect(manager.active).toBe(false);
  });

  it('refuses to exceed the paired device limit', () => {
    const config = testConfig();
    const timestamp = '2026-01-01T00:00:00.000Z';
    for (let index = 0; index < MAX_PAIRED_CLIENTS; index += 1) {
      const suffix = String(index + 1).padStart(12, '0');
      config.pairedClients[`22222222-2222-4222-8222-${suffix}`] = {
        token: Buffer.alloc(32, index + 1).toString('base64url'),
        createdAt: timestamp,
        lastSeenAt: timestamp,
        pluginVersion: 'test',
      };
    }
    expect(() => new PairingManager(config).start()).toThrow(/device limit/i);
  });
});

function testConfig(): ServerConfig {
  return {
    version: 2,
    serverId: '11111111-1111-4111-8111-111111111111',
    daemonSecret: Buffer.alloc(32, 7).toString('base64url'),
    host: '127.0.0.1',
    port: 3900,
    pairedClients: {},
  };
}
