import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BRIDGE_PROTOCOL_VERSION,
  derivePairingMaterial,
  PairingCompleteSchema,
  PairingReadySchema,
  PairingServerHelloSchema,
  pairingTranscript,
  x25519,
} from '@figma-agent/protocol';
import { FakePluginClient } from '@figma-agent/test-support';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { createConfig, loadConfig, saveConfig } from '../config/store.js';
import { BridgeDaemon } from './daemon.js';
import { DaemonBridgeClient } from './daemon-client.js';

const closeTasks: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const close of closeTasks.splice(0).reverse()) await close();
});

describe('short-lived pairing flow', () => {
  it('derives a device token, persists it, authenticates it, then revokes it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'figma-agent-pairing-'));
    closeTasks.push(() => rm(directory, { recursive: true, force: true }));
    const configPath = join(directory, 'config.json');
    const config = await createConfig(configPath);
    config.port = await freePort();
    await saveConfig(config, configPath);

    const daemon = new BridgeDaemon(config, { configPath, idleTimeoutMs: 5_000 });
    closeTasks.push(() => daemon.close());
    await daemon.start();
    const control = new DaemonBridgeClient(config, { autoStart: false, connectTimeoutMs: 1_000 });
    closeTasks.push(() => control.close());
    control.start();
    await control.waitUntilReady();
    await control.request('$daemon.pair.start');
    await expect(control.request('$daemon.pair.start')).rejects.toMatchObject({
      bridgeError: { code: 'BUSY', retryable: true },
    });

    const socket = new WebSocket(`ws://127.0.0.1:${config.port}/pair`);
    closeTasks.push(() => socket.close());
    const hello = PairingServerHelloSchema.parse(await nextMessage(socket));
    const privateKey = randomBytes(32);
    const publicKey = Buffer.from(x25519.getPublicKey(privateKey)).toString('base64url');
    const deviceId = randomUUID();
    const pluginNonce = randomBytes(24).toString('base64url');
    const transcript = pairingTranscript({
      serverId: hello.serverId,
      sessionId: hello.sessionId,
      serverNonce: hello.serverNonce,
      serverPublicKey: hello.serverPublicKey,
      deviceId,
      pluginNonce,
      pluginPublicKey: publicKey,
    });
    const material = derivePairingMaterial(
      privateKey,
      Buffer.from(hello.serverPublicKey, 'base64url'),
      transcript,
    );
    socket.send(
      JSON.stringify({
        type: 'pair.plugin-hello',
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        sessionId: hello.sessionId,
        deviceId,
        pluginNonce,
        pluginPublicKey: publicKey,
        pluginVersion: 'test-plugin',
      }),
    );
    const ready = PairingReadySchema.parse(await nextMessage(socket));
    expect(ready.sas).toBe(material.sas);
    socket.send(
      JSON.stringify({
        type: 'pair.confirm',
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        sessionId: hello.sessionId,
        deviceId,
        proof: Buffer.from(material.confirmationProof).toString('base64url'),
      }),
    );
    PairingCompleteSchema.parse(await nextMessage(socket));

    const token = Buffer.from(material.token).toString('base64url');
    expect((await loadConfig(configPath)).pairedClients[deviceId]?.token).toBe(token);
    const plugin = await FakePluginClient.connect(
      `ws://127.0.0.1:${config.port}`,
      { serverId: config.serverId, deviceId, token },
      (request) => request.method,
    );
    closeTasks.push(() => plugin.close());
    await expect(control.request('status')).resolves.toBe('status');
    await expect(control.request('$daemon.devices.list')).resolves.toEqual([
      expect.objectContaining({ deviceId, connected: true, pluginVersion: 'test-plugin' }),
    ]);

    await control.request('$daemon.devices.revoke', { deviceId });
    await expect.poll(() => daemon.state.pluginConnected).toBe(false);
    expect((await loadConfig(configPath)).pairedClients).toEqual({});
  });
});

async function nextMessage(socket: WebSocket): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    socket.once('message', (data) => {
      try {
        resolve(JSON.parse(data.toString()));
      } catch (error) {
        reject(error);
      }
    });
    socket.once('error', reject);
  });
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
