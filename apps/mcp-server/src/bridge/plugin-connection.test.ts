import { createServer } from 'node:net';

import { FakePluginClient } from '@figma-agent/test-support';
import { afterEach, describe, expect, it } from 'vitest';

import type { ServerConfig } from '../config/store.js';
import { PluginConnectionBroker } from './plugin-connection.js';

const openBrokers: PluginConnectionBroker[] = [];
const openClients: FakePluginClient[] = [];

// 每个测试都可能创建真实 TCP/WebSocket 资源，统一在测试后关闭以避免端口泄漏。
afterEach(async () => {
  for (const client of openClients.splice(0)) client.close();
  for (const broker of openBrokers.splice(0)) await broker.stop();
});

describe('PluginConnectionBroker', () => {
  it('authenticates a plugin and resolves RPC responses', async () => {
    const { broker, url, secret } = await startBroker();
    const client = await FakePluginClient.connect(url, secret, (request) => ({
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

  it('rejects an invalid secret and a second active plugin', async () => {
    const { url, secret } = await startBroker();
    await expect(FakePluginClient.connect(url, `${secret}-wrong`, () => ({}))).rejects.toThrow();
    const first = await FakePluginClient.connect(url, secret, () => ({}));
    openClients.push(first);
    await expect(FakePluginClient.connect(url, secret, () => ({}))).rejects.toThrow();
  });

  it('times out a request without leaking the connection', async () => {
    const { broker, url, secret } = await startBroker();
    const client = await FakePluginClient.connect(url, secret, async () => {
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
  secret: string;
}> {
  // 使用随机空闲端口，使测试可以并行运行且不依赖默认桥接端口。
  const port = await freePort();
  const secret = Buffer.alloc(32, 11).toString('base64url');
  const config: ServerConfig = { version: 1, host: '127.0.0.1', port, secret };
  const broker = new PluginConnectionBroker(config);
  openBrokers.push(broker);
  await broker.start();
  return { broker, url: `ws://127.0.0.1:${port}`, secret };
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
