import { z } from 'zod';

export const bridgeErrorCodes = [
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
export type BridgeErrorCode = z.infer<typeof BridgeErrorCodeSchema>;

export const BridgeErrorSchema = z.object({
  code: BridgeErrorCodeSchema,
  message: z.string().min(1),
  retryable: z.boolean(),
  nodeId: z.string().optional(),
  details: z.unknown().optional(),
});
export type BridgeError = z.infer<typeof BridgeErrorSchema>;

export class BridgeFault extends Error {
  readonly bridgeError: BridgeError;

  constructor(error: BridgeError) {
    super(error.message);
    this.name = 'BridgeFault';
    this.bridgeError = error;
  }
}

export function toBridgeError(value: unknown): BridgeError {
  if (value instanceof BridgeFault) return value.bridgeError;
  if (value instanceof Error) {
    return { code: 'INTERNAL_ERROR', message: value.message, retryable: false };
  }
  return { code: 'INTERNAL_ERROR', message: String(value), retryable: false };
}

