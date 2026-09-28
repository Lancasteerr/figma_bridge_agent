import { z } from 'zod';

import { BRIDGE_PROTOCOL_VERSION } from './constants.js';

/** 服务端发给插件的认证挑战；serverNonce 用于绑定本次连接，避免复用旧 proof。 */
export const AuthChallengeSchema = z.object({
  type: z.literal('auth.challenge'),
  protocolVersion: z.literal(BRIDGE_PROTOCOL_VERSION),
  serverId: z.string().uuid(),
  serverNonce: z.string().min(16),
});

/** 插件对挑战的响应，同时携带插件自己的 nonce 和版本信息。 */
export const AuthPluginProofSchema = z.object({
  type: z.literal('auth.plugin-proof'),
  protocolVersion: z.literal(BRIDGE_PROTOCOL_VERSION),
  serverId: z.string().uuid(),
  deviceId: z.string().uuid(),
  serverNonce: z.string().min(16),
  pluginNonce: z.string().min(16),
  proof: z.string().min(16),
  pluginVersion: z.string().min(1),
});

/** 服务端完成双向认证后返回的 proof，插件据此确认对端掌握配对密钥。 */
export const AuthServerProofSchema = z.object({
  type: z.literal('auth.server-proof'),
  protocolVersion: z.literal(BRIDGE_PROTOCOL_VERSION),
  serverId: z.string().uuid(),
  deviceId: z.string().uuid(),
  serverNonce: z.string(),
  pluginNonce: z.string(),
  proof: z.string(),
});

/** 认证失败时的可序列化原因；code 也用于区分可诊断的连接拒绝场景。 */
export const AuthRejectedSchema = z.object({
  type: z.literal('auth.rejected'),
  code: z.enum([
    'AUTH_FAILED',
    'PROTOCOL_MISMATCH',
    'PLUGIN_ALREADY_CONNECTED',
    'UNKNOWN_DEVICE',
    'DEVICE_REVOKED',
    'SERVER_CHANGED',
  ]),
  message: z.string(),
});

/** WebSocket 握手阶段允许出现的全部消息类型。 */
export const AuthMessageSchema = z.union([
  AuthChallengeSchema,
  AuthPluginProofSchema,
  AuthServerProofSchema,
  AuthRejectedSchema,
]);
/** 认证消息联合类型，供服务端和插件共享同一份线协议定义。 */
export type AuthMessage = z.infer<typeof AuthMessageSchema>;
