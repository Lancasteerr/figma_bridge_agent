import { createHmac, randomBytes } from 'node:crypto';

import {
  AuthChallengeSchema,
  AuthServerProofSchema,
  BRIDGE_PROTOCOL_VERSION,
  RpcRequestSchema,
  type RpcRequest,
} from '@figma-agent/protocol';
import { WebSocket } from 'ws';

export type FakeRpcHandler = (request: RpcRequest) => unknown | Promise<unknown>;

export class FakePluginClient {
  private constructor(
    readonly socket: WebSocket,
    private readonly handler: FakeRpcHandler,
  ) {}

  static async connect(
    url: string,
    secret: string,
    handler: FakeRpcHandler,
  ): Promise<FakePluginClient> {
    const socket = new WebSocket(url);
    const client = new FakePluginClient(socket, handler);
    await client.authenticate(secret);
    return client;
  }

  close(): void {
    this.socket.close(1000, 'Test complete');
  }

  private async authenticate(secret: string): Promise<void> {
    const challenge = AuthChallengeSchema.parse(await nextMessage(this.socket));
    const pluginNonce = randomBytes(24).toString('base64url');
    this.socket.send(
      JSON.stringify({
        type: 'auth.plugin-proof',
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        serverNonce: challenge.serverNonce,
        pluginNonce,
        proof: hmac(secret, `figma-agent/plugin/v1|${challenge.serverNonce}|${pluginNonce}`),
        pluginVersion: 'test-plugin',
      }),
    );
    const proof = AuthServerProofSchema.parse(await nextMessage(this.socket));
    const expected = hmac(secret, `figma-agent/server/v1|${challenge.serverNonce}|${pluginNonce}`);
    if (proof.proof !== expected) throw new Error('Server proof did not match.');
    this.socket.on('message', (data) => void this.onMessage(data.toString()));
  }

  private async onMessage(text: string): Promise<void> {
    const parsed = RpcRequestSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return;
    try {
      const result = await this.handler(parsed.data);
      this.socket.send(
        JSON.stringify({ version: BRIDGE_PROTOCOL_VERSION, id: parsed.data.id, ok: true, result }),
      );
    } catch (error) {
      this.socket.send(
        JSON.stringify({
          version: BRIDGE_PROTOCOL_VERSION,
          id: parsed.data.id,
          ok: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: error instanceof Error ? error.message : String(error),
            retryable: false,
          },
        }),
      );
    }
  }
}

function nextMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
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

function hmac(secret: string, value: string): string {
  return createHmac('sha256', Buffer.from(secret, 'base64url')).update(value).digest('base64url');
}
