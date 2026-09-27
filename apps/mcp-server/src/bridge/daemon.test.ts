import { randomBytes, randomUUID } from 'node:crypto';

import {
  BRIDGE_PROTOCOL_VERSION,
  DaemonAuthChallengeSchema,
  DaemonServerProofSchema,
  RpcResponseSchema,
} from '@figma-agent/protocol';
import { FakePluginClient } from '@figma-agent/test-support';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import type { ServerConfig } from '../config/store.js';
import {
  createDaemonClientProof,
  createDaemonServerProof,
  verifyProof,
} from '../security/proof.js';
import { BridgeDaemon } from './daemon.js';

const daemons: BridgeDaemon[] = [];
const sockets: WebSocket[] = [];
const plugins: FakePluginClient[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  for (const plugin of plugins.splice(0)) plugin.close();
  for (const daemon of daemons.splice(0)) await daemon.close();
});

describe('BridgeDaemon', () => {
  it('routes requests for multiple MCP clients through one plugin connection', async () => {
    const { daemon, secret } = await startDaemon();
    const plugin = await FakePluginClient.connect(
      `ws://127.0.0.1:${daemon.port}`,
      secret,
      (request) => ({ method: request.method, params: request.params }),
    );
    plugins.push(plugin);
    const first = await connectDaemonClient(daemon.port, secret);
    const second = await connectDaemonClient(daemon.port, secret);

    await expect(call(first, 'first', { owner: 1 })).resolves.toEqual({
      method: 'first',
      params: { owner: 1 },
    });
    await expect(call(second, 'second', { owner: 2 })).resolves.toEqual({
      method: 'second',
      params: { owner: 2 },
    });

    first.close();
    await expect(call(second, 'still-alive')).resolves.toEqual({ method: 'still-alive' });
  });

  it('rejects a daemon client with the wrong secret', async () => {
    const { daemon } = await startDaemon();
    await expect(
      connectDaemonClient(daemon.port, 'wrong-secret-value-that-is-long-enough'),
    ).rejects.toThrow('Daemon authentication rejected');
  });

  it('exits after the configured idle window', async () => {
    const { daemon } = await startDaemon(20);
    await daemon.waitUntilStopped();
  });
});

async function startDaemon(idleTimeoutMs = 5_000): Promise<{
  daemon: BridgeDaemon;
  secret: string;
}> {
  const secret = Buffer.alloc(32, 13).toString('base64url');
  const config: ServerConfig = { version: 1, host: '127.0.0.1', port: 0, secret };
  const daemon = new BridgeDaemon(config, { idleTimeoutMs });
  daemons.push(daemon);
  await daemon.start();
  return { daemon, secret };
}

async function connectDaemonClient(port: number, secret: string): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/mcp`);
  sockets.push(socket);
  return await new Promise<WebSocket>((resolve, reject) => {
    let daemonNonce = '';
    let clientNonce = '';
    socket.on('message', (data) => {
      const value: unknown = JSON.parse(data.toString());
      if (
        typeof value === 'object' &&
        value &&
        'type' in value &&
        value.type === 'daemon.auth.rejected'
      ) {
        reject(new Error('Daemon authentication rejected'));
        return;
      }
      const challenge = DaemonAuthChallengeSchema.safeParse(value);
      if (challenge.success) {
        daemonNonce = challenge.data.daemonNonce;
        clientNonce = randomBytes(24).toString('base64url');
        socket.send(
          JSON.stringify({
            type: 'daemon.auth.client-proof',
            protocolVersion: BRIDGE_PROTOCOL_VERSION,
            daemonNonce,
            clientNonce,
            proof: createDaemonClientProof(secret, daemonNonce, clientNonce),
            clientVersion: 'test-client',
          }),
        );
        return;
      }
      const proof = DaemonServerProofSchema.safeParse(value);
      if (proof.success) {
        if (
          !verifyProof(proof.data.proof, createDaemonServerProof(secret, daemonNonce, clientNonce))
        ) {
          reject(new Error('Daemon server proof did not match'));
          return;
        }
        resolve(socket);
      }
    });
    socket.once('error', reject);
  });
}

async function call(socket: WebSocket, method: string, params?: unknown): Promise<unknown> {
  const id = randomUUID();
  const result = new Promise<unknown>((resolve, reject) => {
    const listener = (data: WebSocket.RawData): void => {
      const response = RpcResponseSchema.safeParse(JSON.parse(data.toString()));
      if (!response.success || response.data.id !== id) return;
      socket.off('message', listener);
      if (response.data.ok) resolve(response.data.result);
      else reject(new Error(response.data.error.message));
    };
    socket.on('message', listener);
  });
  socket.send(
    JSON.stringify({ version: BRIDGE_PROTOCOL_VERSION, id, method, ...(params ? { params } : {}) }),
  );
  return await result;
}
