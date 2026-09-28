import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { z } from 'zod';

import { BRIDGE_PROTOCOL_VERSION } from './constants.js';

export const PairingServerHelloSchema = z.object({
  type: z.literal('pair.server-hello'),
  protocolVersion: z.literal(BRIDGE_PROTOCOL_VERSION),
  serverId: z.string().uuid(),
  sessionId: z.string().uuid(),
  serverNonce: z.string().min(16),
  serverPublicKey: z.string().min(32),
  expiresAt: z.number().int().positive(),
});

export const PairingPluginHelloSchema = z.object({
  type: z.literal('pair.plugin-hello'),
  protocolVersion: z.literal(BRIDGE_PROTOCOL_VERSION),
  sessionId: z.string().uuid(),
  deviceId: z.string().uuid(),
  pluginNonce: z.string().min(16),
  pluginPublicKey: z.string().min(32),
  pluginVersion: z.string().min(1),
});

export const PairingReadySchema = z.object({
  type: z.literal('pair.ready'),
  protocolVersion: z.literal(BRIDGE_PROTOCOL_VERSION),
  serverId: z.string().uuid(),
  sessionId: z.string().uuid(),
  sas: z.string().regex(/^\d{6}$/),
});

export const PairingConfirmSchema = z.object({
  type: z.literal('pair.confirm'),
  protocolVersion: z.literal(BRIDGE_PROTOCOL_VERSION),
  sessionId: z.string().uuid(),
  deviceId: z.string().uuid(),
  proof: z.string().min(32),
});

export const PairingCompleteSchema = z.object({
  type: z.literal('pair.complete'),
  protocolVersion: z.literal(BRIDGE_PROTOCOL_VERSION),
  serverId: z.string().uuid(),
  sessionId: z.string().uuid(),
});

export const PairingRejectedSchema = z.object({
  type: z.literal('pair.rejected'),
  code: z.enum([
    'PAIRING_DISABLED',
    'PAIRING_BUSY',
    'PAIRING_EXPIRED',
    'PAIRING_CANCELLED',
    'DEVICE_LIMIT',
    'INVALID_MESSAGE',
    'CONFIRMATION_FAILED',
  ]),
  message: z.string().min(1),
});

export const PairingMessageSchema = z.union([
  PairingServerHelloSchema,
  PairingPluginHelloSchema,
  PairingReadySchema,
  PairingConfirmSchema,
  PairingCompleteSchema,
  PairingRejectedSchema,
]);

export interface PairingTranscriptInput {
  serverId: string;
  sessionId: string;
  serverNonce: string;
  serverPublicKey: string;
  deviceId: string;
  pluginNonce: string;
  pluginPublicKey: string;
}

/** 固定字段顺序的 transcript 同时绑定服务身份、会话和双方临时密钥。 */
export function pairingTranscript(input: PairingTranscriptInput): string {
  return [
    'figma-agent/pair/v2',
    input.serverId,
    input.sessionId,
    input.serverNonce,
    input.serverPublicKey,
    input.deviceId,
    input.pluginNonce,
    input.pluginPublicKey,
  ].join('|');
}

export interface PairingMaterial {
  sas: string;
  token: Uint8Array;
  confirmationProof: Uint8Array;
}

/** 双方从 X25519 shared secret 派生相互独立的 SAS、设备 token 和确认 proof。 */
export function derivePairingMaterial(
  privateKey: Uint8Array,
  peerPublicKey: Uint8Array,
  transcript: string,
): PairingMaterial {
  const transcriptBytes = utf8ToBytes(transcript);
  const sharedSecret = x25519.getSharedSecret(privateKey, peerPublicKey);
  const salt = sha256(transcriptBytes);
  const token = hkdf(sha256, sharedSecret, salt, utf8ToBytes('figma-agent/device-token/v2'), 32);
  const sasBytes = hkdf(sha256, sharedSecret, salt, utf8ToBytes('figma-agent/sas/v2'), 4);
  const sasNumber =
    (((sasBytes[0] ?? 0) << 24) |
      ((sasBytes[1] ?? 0) << 16) |
      ((sasBytes[2] ?? 0) << 8) |
      (sasBytes[3] ?? 0)) >>>
    0;
  const confirmationProof = hmac(
    sha256,
    token,
    utf8ToBytes(`figma-agent/pair-confirm/v2|${transcript}`),
  );
  return { sas: String(sasNumber % 1_000_000).padStart(6, '0'), token, confirmationProof };
}

export { x25519 };
export type PairingMessage = z.infer<typeof PairingMessageSchema>;
