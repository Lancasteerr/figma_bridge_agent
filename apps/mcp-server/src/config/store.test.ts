import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createConfig, loadConfig, updateConfig } from './store.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('v2 config store', () => {
  it('creates separate daemon identity and empty plugin devices', async () => {
    const path = await configPath();
    const config = await createConfig(path);
    expect(config).toMatchObject({ version: 2, host: '127.0.0.1', port: 3900, pairedClients: {} });
    expect(config.serverId).toMatch(/^[0-9a-f-]{36}$/);
    expect(config.daemonSecret.length).toBeGreaterThanOrEqual(32);
  });

  it('migrates v1 by rotating the shared secret and requiring plugin re-pairing', async () => {
    const path = await configPath();
    const legacySecret = Buffer.alloc(32, 5).toString('base64url');
    await writeFile(
      path,
      JSON.stringify({ version: 1, secret: legacySecret, host: '127.0.0.1', port: 3900 }),
    );
    const migrated = await loadConfig(path);
    expect(migrated.version).toBe(2);
    expect(migrated.daemonSecret).not.toBe(legacySecret);
    expect(migrated.pairedClients).toEqual({});
    expect(JSON.parse(await readFile(path, 'utf8'))).not.toHaveProperty('secret');
  });

  it('serializes concurrent device updates without losing either device', async () => {
    const path = await configPath();
    await createConfig(path);
    const timestamp = '2026-01-01T00:00:00.000Z';
    await Promise.all(
      ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'].map(
        (deviceId, index) =>
          updateConfig(
            (config) => ({
              ...config,
              pairedClients: {
                ...config.pairedClients,
                [deviceId]: {
                  token: Buffer.alloc(32, index + 1).toString('base64url'),
                  createdAt: timestamp,
                  lastSeenAt: timestamp,
                  pluginVersion: 'test',
                },
              },
            }),
            path,
          ),
      ),
    );
    expect(Object.keys((await loadConfig(path)).pairedClients)).toHaveLength(2);
  });
});

async function configPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'figma-agent-config-'));
  temporaryDirectories.push(directory);
  return join(directory, 'config.json');
}
