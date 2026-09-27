import { z } from 'zod';

/**
 * 跨越 MCP、WebSocket 和插件边界的稳定错误码集合。
 * retryable 不由调用方猜测，而由产生错误的一侧明确声明。
 */
export const bridgeErrorCodes = [
  'BRIDGE_UNAVAILABLE',
  'PLUGIN_NOT_CONNECTED',
  'AUTH_REQUIRED',
  'AUTH_FAILED',
  'PROTOCOL_MISMATCH',
  'PLUGIN_ALREADY_CONNECTED',
  'NODE_NOT_FOUND',
  'NODE_NOT_IN_CURRENT_PAGE',
  'NODE_NOT_IN_PROPOSAL',
  'PROPOSAL_CHANGED',
  'UNSUPPORTED_NODE_TYPE',
  'INVALID_LAYOUT',
  'NODE_INSIDE_INSTANCE',
  'NODE_LOCKED',
  'MISSING_FONT',
  'PAGE_NOT_LOADED',
  'LIMIT_EXCEEDED',
  'PAYLOAD_TOO_LARGE',
  'EXPORT_FAILED',
  'RPC_TIMEOUT',
  'PLAN_INVALID',
  'PLAN_STALE',
  'VALIDATION_EXPIRED',
  'BUSY',
  'INTERNAL_ERROR',
] as const;

export const BridgeErrorCodeSchema = z.enum(bridgeErrorCodes);
/** 桥接错误码的 TypeScript 联合类型。 */
export type BridgeErrorCode = z.infer<typeof BridgeErrorCodeSchema>;

/** 对外返回的错误 wire shape；details 可承载诊断信息，但不改变主错误码。 */
export const BridgeErrorSchema = z.object({
  code: BridgeErrorCodeSchema,
  message: z.string().min(1),
  retryable: z.boolean(),
  nodeId: z.string().optional(),
  details: z.unknown().optional(),
});
/** 所有跨进程传递的标准错误结构。 */
export type BridgeError = z.infer<typeof BridgeErrorSchema>;

/** 在插件内部保留结构化错误，并在跨边界时转换为 BridgeError。 */
export class BridgeFault extends Error {
  readonly bridgeError: BridgeError;

  constructor(error: BridgeError) {
    super(error.message);
    this.name = 'BridgeFault';
    this.bridgeError = error;
  }
}

/** 将任意异常归一化为不会泄漏实现细节的桥接错误。 */
export function toBridgeError(value: unknown): BridgeError {
  if (value instanceof BridgeFault) return value.bridgeError;
  if (value instanceof Error) {
    return { code: 'INTERNAL_ERROR', message: value.message, retryable: false };
  }
  return { code: 'INTERNAL_ERROR', message: String(value), retryable: false };
}
