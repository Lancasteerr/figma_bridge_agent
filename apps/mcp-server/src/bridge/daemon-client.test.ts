import { createServer } from 'node:net';

import { FakePluginClient } from '@figma-agent/test-support';
import { afterEach, describe, expect, it } from 'vitest';

import type { ServerConfig } from '../config/store.js';
import { BridgeDaemon } from './daemon.js';
import { DaemonBridgeClient } from './daemon-client.js';

const daemons: BridgeDaemon[] = [];
const clients: DaemonBridgeClient[] = [];
const plugins: FakePluginClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  for (const plugin of plugins.splice(0)) plugin.close();
  for (const daemon of daemons.splice(0)) await daemon.close();
});

describe('DaemonBridgeClient', () => {
  it('connects to the daemon and forwards plugin RPC', async () => {
    const { daemon, config } = await startDaemon();
    const plugin = await FakePluginClient.connect(
      `ws://127.0.0.1:${daemon.port}`,
      config.secret,
      (request) => ({ method: request.method }),
    );
    plugins.push(plugin);
    const client = createClient({ ...config, port: daemon.port });
    client.start();

    await client.waitUntilReady();
    await expect(client.request('status')).resolves.toEqual({ method: 'status' });
    await expect(client.request('$daemon.status')).resolves.toMatchObject({
      pluginConnected: true,
      clientCount: 1,
    });
  });

  it('returns BRIDGE_UNAVAILABLE while no daemon is listening', async () => {
    const port = await freePort();
    const client = createClient(
      { version: 1, host: '127.0.0.1', port, secret: Buffer.alloc(32, 5).toString('base64url') },
      50,
    );
    await expect(client.request('status')).rejects.toMatchObject({
      bridgeError: { code: 'BRIDGE_UNAVAILABLE', retryable: true },
    });
  });

  it('keeps another client usable after one client closes', async () => {
    const { daemon, config } = await startDaemon();
    const plugin = await FakePluginClient.connect(
      `ws://127.0.0.1:${daemon.port}`,
      config.secret,
      (request) => request.method,
    );
    plugins.push(plugin);
    const first = createClient({ ...config, port: daemon.port });
    const second = createClient({ ...config, port: daemon.port });
    first.start();
    second.start();
    await Promise.all([first.waitUntilReady(), second.waitUntilReady()]);

    await first.close();
    await expect(second.request('getSelection')).resolves.toBe('getSelection');
  });
});

async function startDaemon(): Promise<{ daemon: BridgeDaemon; config: ServerConfig }> {
  const config: ServerConfig = {
    version: 1,
    host: '127.0.0.1',
    port: 0,
    secret: Buffer.alloc(32, 17).toString('base64url'),
  };
  const daemon = new BridgeDaemon(config, { idleTimeoutMs: 5_000 });
  daemons.push(daemon);
  await daemon.start();
  return { daemon, config };
}

function createClient(config: ServerConfig, connectTimeoutMs = 500): DaemonBridgeClient {
  const client = new DaemonBridgeClient(config, {
    autoStart: false,
    connectTimeoutMs,
    spawnDaemon: () => undefined,
  });
  clients.push(client);
  return client;
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No TCP port was assigned.');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}
