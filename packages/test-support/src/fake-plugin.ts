import { createHmac, randomBytes } from 'node:crypto';

import {
  AuthChallengeSchema,
  AuthServerProofSchema,
  BRIDGE_PROTOCOL_VERSION,
  RpcRequestSchema,
  type RpcRequest,
} from '@figma-agent/protocol';
import { WebSocket } from 'ws';

/** 测试插件只模拟协议行为，不依赖真实 Figma API。 */
export type FakeRpcHandler = (request: RpcRequest) => unknown | Promise<unknown>;

/**
 * 用于桥接集成测试的最小插件客户端：先完成双向鉴权，再回显 RPC 结果。
 */
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

  /** 主动关闭测试连接，避免测试之间共享 WebSocket 状态。 */
  close(): void {
    this.socket.close(1000, 'Test complete');
  }

  private async authenticate(secret: string): Promise<void> {
    // 测试客户端复用生产协议的两个 context，确保 proof 方向和真实插件一致。
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
  // 认证阶段只等待下一条消息；解析失败直接让连接测试失败，便于定位协议回归。
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
