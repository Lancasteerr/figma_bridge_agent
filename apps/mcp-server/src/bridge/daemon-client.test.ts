import { createServer } from 'node:net';

import { BRIDGE_PROTOCOL_VERSION } from '@figma-agent/protocol';
import { FakePluginClient } from '@figma-agent/test-support';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';

import type { ServerConfig } from '../config/store.js';
import { createDaemonServerProof } from '../security/proof.js';
import { BridgeDaemon } from './daemon.js';
import { DaemonBridgeClient } from './daemon-client.js';

const daemons: BridgeDaemon[] = [];
const clients: DaemonBridgeClient[] = [];
const plugins: FakePluginClient[] = [];
const webSocketServers: WebSocketServer[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  for (const plugin of plugins.splice(0)) plugin.close();
  for (const daemon of daemons.splice(0)) await daemon.close();
  for (const server of webSocketServers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe('DaemonBridgeClient', () => {
  it('connects to the daemon and forwards plugin RPC', async () => {
    const { daemon, config } = await startDaemon();
    const plugin = await FakePluginClient.connect(
      `ws://127.0.0.1:${daemon.port}`,
      pluginAuth(config),
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

  it('advertises the injected CLI version during daemon authentication', async () => {
    const port = await freePort();
    const config = testConfig(port, 29, false);
    const daemonNonce = Buffer.alloc(24, 7).toString('base64url');
    let advertisedVersion = '';
    const server = new WebSocketServer({ host: config.host, port });
    webSocketServers.push(server);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    server.on('connection', (socket) => {
      socket.send(
        JSON.stringify({
          type: 'daemon.auth.challenge',
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          daemonNonce,
        }),
      );
      socket.once('message', (raw) => {
        const proof = JSON.parse(String(raw)) as {
          clientNonce: string;
          clientVersion: string;
        };
        advertisedVersion = proof.clientVersion;
        socket.send(
          JSON.stringify({
            type: 'daemon.auth.server-proof',
            protocolVersion: BRIDGE_PROTOCOL_VERSION,
            daemonNonce,
            clientNonce: proof.clientNonce,
            proof: createDaemonServerProof(config.daemonSecret, daemonNonce, proof.clientNonce),
          }),
        );
      });
    });

    const client = createClient(config);
    client.start();
    await client.waitUntilReady();

    expect(advertisedVersion).toBe(__CLI_VERSION__);
  });

  it('returns BRIDGE_UNAVAILABLE while no daemon is listening', async () => {
    const port = await freePort();
    const client = createClient(testConfig(port, 5, false), 50);
    await expect(client.request('status')).rejects.toMatchObject({
      bridgeError: { code: 'BRIDGE_UNAVAILABLE', retryable: true },
    });
  });

  it('keeps another client usable after one client closes', async () => {
    const { daemon, config } = await startDaemon();
    const plugin = await FakePluginClient.connect(
      `ws://127.0.0.1:${daemon.port}`,
      pluginAuth(config),
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

  it('auto-starts one shared daemon for concurrent clients', async () => {
    const port = await freePort();
    const config = testConfig(port, 23, false);
    let daemon: BridgeDaemon | undefined;
    let starting: Promise<void> | undefined;
    const spawnDaemon = (): void => {
      if (starting) return;
      daemon = new BridgeDaemon(config, { idleTimeoutMs: 5_000 });
      daemons.push(daemon);
      starting = daemon.start();
    };
    const first = new DaemonBridgeClient(config, { spawnDaemon, connectTimeoutMs: 1_000 });
    const second = new DaemonBridgeClient(config, { spawnDaemon, connectTimeoutMs: 1_000 });
    clients.push(first, second);
    first.start();
    second.start();

    await Promise.all([first.waitUntilReady(), second.waitUntilReady(), starting]);
    expect(daemon).toBeDefined();
    await expect(first.request('$daemon.status')).resolves.toMatchObject({ clientCount: 2 });
  });

  it('reconnects after the daemon is restarted', async () => {
    const { daemon, config } = await startDaemon();
    const clientConfig = { ...config, port: daemon.port };
    const client = createClient(clientConfig, 250);
    client.start();
    await client.waitUntilReady();
    await daemon.close();

    const replacement = new BridgeDaemon(clientConfig, { idleTimeoutMs: 5_000 });
    daemons.push(replacement);
    await replacement.start();
    await expect.poll(() => client.daemonConnected, { timeout: 2_000 }).toBe(true);
    await expect(client.request('$daemon.status')).resolves.toMatchObject({ pid: process.pid });
  });

  it('stops the daemon through the authenticated control method', async () => {
    const { daemon, config } = await startDaemon();
    const client = createClient({ ...config, port: daemon.port });
    client.start();
    await client.waitUntilReady();
    await client.request('$daemon.stop');
    await daemon.waitUntilStopped();
  });
});

async function startDaemon(): Promise<{ daemon: BridgeDaemon; config: ServerConfig }> {
  const config = testConfig(0, 17, true);
  const daemon = new BridgeDaemon(config, { idleTimeoutMs: 5_000 });
  daemons.push(daemon);
  await daemon.start();
  return { daemon, config };
}

function testConfig(port: number, seed: number, withPlugin: boolean): ServerConfig {
  const deviceId = '22222222-2222-4222-8222-222222222222';
  const token = Buffer.alloc(32, seed + 1).toString('base64url');
  const timestamp = '2026-01-01T00:00:00.000Z';
  return {
    version: 2,
    serverId: '11111111-1111-4111-8111-111111111111',
    daemonSecret: Buffer.alloc(32, seed).toString('base64url'),
    host: '127.0.0.1',
    port,
    pairedClients: withPlugin
      ? {
          [deviceId]: {
            token,
            createdAt: timestamp,
            lastSeenAt: timestamp,
            pluginVersion: 'test-plugin',
          },
        }
      : {},
  };
}

function pluginAuth(config: ServerConfig): { serverId: string; deviceId: string; token: string } {
  const entry = Object.entries(config.pairedClients)[0];
  if (!entry) throw new Error('Test config has no paired plugin.');
  return { serverId: config.serverId, deviceId: entry[0], token: entry[1].token };
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
