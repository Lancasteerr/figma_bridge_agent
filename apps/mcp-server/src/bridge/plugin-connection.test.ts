import { createServer } from 'node:net';

import { FakePluginClient } from '@figma-agent/test-support';
import { afterEach, describe, expect, it } from 'vitest';

import type { ServerConfig } from '../config/store.js';
import { PluginConnectionBroker } from './plugin-connection.js';
import { PluginGateway } from './plugin-gateway.js';

const openBrokers: PluginConnectionBroker[] = [];
const openGateways: PluginGateway[] = [];
const openClients: FakePluginClient[] = [];

// 每个测试都可能创建真实 TCP/WebSocket 资源，统一在测试后关闭以避免端口泄漏。
afterEach(async () => {
  for (const client of openClients.splice(0)) client.close();
  for (const gateway of openGateways.splice(0)) await gateway.close();
  for (const broker of openBrokers.splice(0)) await broker.stop();
});

describe('PluginConnectionBroker', () => {
  it('authenticates a plugin and resolves RPC responses', async () => {
    const { broker, url, auth } = await startBroker();
    const client = await FakePluginClient.connect(url, auth, (request) => ({
      method: request.method,
      params: request.params,
    }));
    openClients.push(client);

    await expect(broker.request('status', { detail: true })).resolves.toEqual({
      method: 'status',
      params: { detail: true },
    });
  });

  it('fails immediately while the plugin is disconnected', async () => {
    const { broker } = await startBroker();
    await expect(broker.request('status')).rejects.toMatchObject({
      bridgeError: { code: 'PLUGIN_NOT_CONNECTED', retryable: true },
    });
  });

  it('documents the fixed-port conflict between two legacy server sessions', async () => {
    const { config } = await startBroker();
    const competingBroker = new PluginConnectionBroker(config);
    const competingGateway = new PluginGateway(config, competingBroker);
    openGateways.push(competingGateway);
    await expect(competingGateway.start()).rejects.toMatchObject({ code: 'EADDRINUSE' });
  });

  it('rejects an invalid secret and a second active plugin', async () => {
    const { url, auth } = await startBroker();
    await expect(
      FakePluginClient.connect(url, { ...auth, token: `${auth.token}-wrong` }, () => ({})),
    ).rejects.toThrow();
    const first = await FakePluginClient.connect(url, auth, () => ({}));
    openClients.push(first);
    await expect(FakePluginClient.connect(url, auth, () => ({}))).rejects.toThrow();
  });

  it('times out a request without leaking the connection', async () => {
    const { broker, url, auth } = await startBroker();
    const client = await FakePluginClient.connect(url, auth, async () => {
      await new Promise(() => undefined);
    });
    openClients.push(client);
    await expect(broker.request('slow', undefined, 20)).rejects.toMatchObject({
      bridgeError: { code: 'RPC_TIMEOUT', retryable: true },
    });
  });
});

async function startBroker(): Promise<{
  broker: PluginConnectionBroker;
  url: string;
  auth: { serverId: string; deviceId: string; token: string };
  config: ServerConfig;
}> {
  // 使用随机空闲端口，使测试可以并行运行且不依赖默认桥接端口。
  const port = await freePort();
  const secret = Buffer.alloc(32, 11).toString('base64url');
  const serverId = '11111111-1111-4111-8111-111111111111';
  const deviceId = '22222222-2222-4222-8222-222222222222';
  const config: ServerConfig = {
    version: 2,
    serverId,
    daemonSecret: Buffer.alloc(32, 12).toString('base64url'),
    host: '127.0.0.1',
    port,
    pairedClients: {
      [deviceId]: {
        token: secret,
        createdAt: '2026-01-01T00:00:00.000Z',
        lastSeenAt: '2026-01-01T00:00:00.000Z',
        pluginVersion: 'test-plugin',
      },
    },
  };
  const broker = new PluginConnectionBroker(config);
  const gateway = new PluginGateway(config, broker);
  openBrokers.push(broker);
  openGateways.push(gateway);
  await gateway.start();
  return {
    broker,
    url: `ws://127.0.0.1:${port}`,
    auth: { serverId, deviceId, token: secret },
    config,
  };
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
