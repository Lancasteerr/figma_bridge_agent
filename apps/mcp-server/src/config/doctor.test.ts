import { createServer, type Server, type Socket } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { BridgeDaemon } from '../bridge/daemon.js';
import { PluginConnectionBroker } from '../bridge/plugin-connection.js';
import { PluginGateway } from '../bridge/plugin-gateway.js';
import { inspectBridge } from './doctor.js';
import type { ServerConfig } from './store.js';

const closeCallbacks: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of closeCallbacks.splice(0).reverse()) await close();
});

describe('inspectBridge', () => {
  it('reports stopped for an available port', async () => {
    const config = await testConfig();
    await expect(inspectBridge(config)).resolves.toEqual({ daemonState: 'stopped' });
  });

  it('reports a healthy daemon and its plugin state', async () => {
    const base = await testConfig();
    const daemon = new BridgeDaemon(base, { idleTimeoutMs: 5_000 });
    closeCallbacks.push(() => daemon.close());
    await daemon.start();
    const config = { ...base, port: daemon.port };
    await expect(inspectBridge(config)).resolves.toMatchObject({
      daemonState: 'running',
      status: { pluginConnected: false, clientCount: 1 },
    });
  });

  it('distinguishes a legacy bridge from an unrelated listener', async () => {
    const legacyConfig = await testConfig();
    const broker = new PluginConnectionBroker(legacyConfig);
    const gateway = new PluginGateway(legacyConfig, broker);
    closeCallbacks.push(async () => {
      await gateway.close();
      await broker.close();
    });
    await gateway.start();
    await expect(inspectBridge(legacyConfig)).resolves.toMatchObject({ daemonState: 'legacy' });

    const unrelatedConfig = await testConfig();
    const unrelatedSockets = new Set<Socket>();
    const unrelated = createServer((socket) => {
      unrelatedSockets.add(socket);
      socket.once('close', () => unrelatedSockets.delete(socket));
      socket.on('error', () => undefined);
      socket.end('not a websocket');
    });
    await listen(unrelated, unrelatedConfig.port);
    closeCallbacks.push(async () => {
      for (const socket of unrelatedSockets) socket.destroy();
      await closeServer(unrelated);
    });
    await expect(inspectBridge(unrelatedConfig)).resolves.toMatchObject({
      daemonState: 'port-occupied',
    });
  });
});

async function testConfig(): Promise<ServerConfig> {
  return {
    version: 1,
    host: '127.0.0.1',
    port: await freePort(),
    secret: Buffer.alloc(32, 19).toString('base64url'),
  };
}

async function freePort(): Promise<number> {
  const server = createServer();
  await listen(server, 0);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No TCP port was assigned.');
  const port = address.port;
  await closeServer(server);
  return port;
}

async function listen(server: Server, port: number): Promise<void> {
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
