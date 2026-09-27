import { z } from 'zod';

import { BRIDGE_PROTOCOL_VERSION } from './constants.js';

/** Daemon 给本机 MCP 客户端的挑战，与插件认证使用不同消息和 HMAC context。 */
export const DaemonAuthChallengeSchema = z.object({
  type: z.literal('daemon.auth.challenge'),
  protocolVersion: z.literal(BRIDGE_PROTOCOL_VERSION),
  daemonNonce: z.string().min(16),
});

/** MCP 客户端证明自己持有本机配置中的配对密钥。 */
export const DaemonClientProofSchema = z.object({
  type: z.literal('daemon.auth.client-proof'),
  protocolVersion: z.literal(BRIDGE_PROTOCOL_VERSION),
  daemonNonce: z.string().min(16),
  clientNonce: z.string().min(16),
  proof: z.string().min(16),
  clientVersion: z.string().min(1),
});

/** Daemon 的反向证明，避免 MCP 客户端连接到端口上的未知服务。 */
export const DaemonServerProofSchema = z.object({
  type: z.literal('daemon.auth.server-proof'),
  protocolVersion: z.literal(BRIDGE_PROTOCOL_VERSION),
  daemonNonce: z.string().min(16),
  clientNonce: z.string().min(16),
  proof: z.string().min(16),
});

/** Daemon 客户端认证阶段的稳定拒绝原因。 */
export const DaemonAuthRejectedSchema = z.object({
  type: z.literal('daemon.auth.rejected'),
  code: z.enum(['AUTH_FAILED', 'PROTOCOL_MISMATCH']),
  message: z.string().min(1),
});

/** Daemon 状态会在认证完成和插件状态变化时推送给全部 MCP 客户端。 */
export const DaemonStateSchema = z.object({
  type: z.literal('daemon.state'),
  protocolVersion: z.literal(BRIDGE_PROTOCOL_VERSION),
  pid: z.number().int().positive(),
  clientCount: z.number().int().nonnegative(),
  pluginConnected: z.boolean(),
  pluginVersion: z.string().min(1).optional(),
  pendingCount: z.number().int().nonnegative(),
});

export type DaemonState = z.infer<typeof DaemonStateSchema>;

/** 控制命令返回的数据结构；stdio 普通 RPC 不会把这些方法转发给插件。 */
export const DaemonStatusResultSchema = DaemonStateSchema.omit({ type: true });
export type DaemonStatusResult = z.infer<typeof DaemonStatusResultSchema>;

export const DaemonAuthMessageSchema = z.union([
  DaemonAuthChallengeSchema,
  DaemonClientProofSchema,
  DaemonServerProofSchema,
  DaemonAuthRejectedSchema,
]);
