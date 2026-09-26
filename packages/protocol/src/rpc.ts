import { z } from 'zod';

import { BRIDGE_PROTOCOL_VERSION } from './constants.js';
import { BridgeErrorSchema } from './errors.js';

export const RpcRequestSchema = z.object({
  version: z.literal(BRIDGE_PROTOCOL_VERSION),
  id: z.string().min(1),
  method: z.string().min(1),
  params: z.unknown().optional(),
  timeoutMs: z.number().int().positive().max(120_000).optional(),
});
export type RpcRequest = z.infer<typeof RpcRequestSchema>;

export const RpcSuccessSchema = z.object({
  version: z.literal(BRIDGE_PROTOCOL_VERSION),
  id: z.string().min(1),
  ok: z.literal(true),
  result: z.unknown(),
});
export type RpcSuccess = z.infer<typeof RpcSuccessSchema>;

export const RpcFailureSchema = z.object({
  version: z.literal(BRIDGE_PROTOCOL_VERSION),
  id: z.string().min(1),
  ok: z.literal(false),
  error: BridgeErrorSchema,
});
export type RpcFailure = z.infer<typeof RpcFailureSchema>;

export const RpcResponseSchema = z.discriminatedUnion('ok', [RpcSuccessSchema, RpcFailureSchema]);
export type RpcResponse = z.infer<typeof RpcResponseSchema>;

export const rpcEventNames = [
  'selectionChanged',
  'currentPageChanged',
  'nodeChanged',
  'pluginConnected',
  'pluginDisconnected',
] as const;

export const RpcEventSchema = z.object({
  version: z.literal(BRIDGE_PROTOCOL_VERSION),
  event: z.enum(rpcEventNames),
  sequence: z.number().int().nonnegative(),
  payload: z.unknown(),
});
export type RpcEvent = z.infer<typeof RpcEventSchema>;

export const RpcMessageSchema = z.union([RpcRequestSchema, RpcResponseSchema, RpcEventSchema]);
export type RpcMessage = z.infer<typeof RpcMessageSchema>;

