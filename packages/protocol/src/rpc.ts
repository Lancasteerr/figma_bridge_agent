import { z } from 'zod';

import { BRIDGE_PROTOCOL_VERSION } from './constants.js';
import { BridgeErrorSchema } from './errors.js';

/** 服务端或插件发起的 RPC 请求；timeoutMs 只描述调用方的等待上限。 */
export const RpcRequestSchema = z.object({
  version: z.literal(BRIDGE_PROTOCOL_VERSION),
  id: z.string().min(1),
  method: z.string().min(1),
  params: z.unknown().optional(),
  timeoutMs: z.number().int().positive().max(120_000).optional(),
});
/** RPC 请求类型。 */
export type RpcRequest = z.infer<typeof RpcRequestSchema>;

/** 成功响应保留原始 result，由具体工具 schema 负责进一步校验。 */
export const RpcSuccessSchema = z.object({
  version: z.literal(BRIDGE_PROTOCOL_VERSION),
  id: z.string().min(1),
  ok: z.literal(true),
  result: z.unknown(),
});
/** 成功响应类型。 */
export type RpcSuccess = z.infer<typeof RpcSuccessSchema>;

/** 失败响应统一携带 BridgeError，保证跨边界错误可处理。 */
export const RpcFailureSchema = z.object({
  version: z.literal(BRIDGE_PROTOCOL_VERSION),
  id: z.string().min(1),
  ok: z.literal(false),
  error: BridgeErrorSchema,
});
/** 失败响应类型。 */
export type RpcFailure = z.infer<typeof RpcFailureSchema>;

/** 使用 ok 作为判别字段，避免调用方同时猜测 result 和 error 是否存在。 */
export const RpcResponseSchema = z.discriminatedUnion('ok', [RpcSuccessSchema, RpcFailureSchema]);
/** RPC 响应联合类型。 */
export type RpcResponse = z.infer<typeof RpcResponseSchema>;

/** 插件主动推送的事件名称采用封闭集合，防止未声明事件穿过协议边界。 */
export const rpcEventNames = [
  'selectionChanged',
  'currentPageChanged',
  'nodeChanged',
  'pluginConnected',
  'pluginDisconnected',
] as const;

/** 事件带有单调 sequence，供客户端在需要时判断事件顺序。 */
export const RpcEventSchema = z.object({
  version: z.literal(BRIDGE_PROTOCOL_VERSION),
  event: z.enum(rpcEventNames),
  sequence: z.number().int().nonnegative(),
  payload: z.unknown(),
});
/** RPC 事件类型。 */
export type RpcEvent = z.infer<typeof RpcEventSchema>;

/** 线协议上允许出现的请求、响应和事件。 */
export const RpcMessageSchema = z.union([RpcRequestSchema, RpcResponseSchema, RpcEventSchema]);
/** 全部 RPC 消息类型。 */
export type RpcMessage = z.infer<typeof RpcMessageSchema>;
