import { z } from 'zod';

import { BRIDGE_PROTOCOL_VERSION } from './constants.js';

export const AuthChallengeSchema = z.object({
  type: z.literal('auth.challenge'),
  protocolVersion: z.literal(BRIDGE_PROTOCOL_VERSION),
  serverNonce: z.string().min(16),
});

export const AuthPluginProofSchema = z.object({
  type: z.literal('auth.plugin-proof'),
  protocolVersion: z.literal(BRIDGE_PROTOCOL_VERSION),
  serverNonce: z.string().min(16),
  pluginNonce: z.string().min(16),
  proof: z.string().min(16),
  pluginVersion: z.string().min(1),
});

export const AuthServerProofSchema = z.object({
  type: z.literal('auth.server-proof'),
  protocolVersion: z.literal(BRIDGE_PROTOCOL_VERSION),
  serverNonce: z.string(),
  pluginNonce: z.string(),
  proof: z.string(),
});

export const AuthRejectedSchema = z.object({
  type: z.literal('auth.rejected'),
  code: z.enum(['AUTH_FAILED', 'PROTOCOL_MISMATCH', 'PLUGIN_ALREADY_CONNECTED']),
  message: z.string(),
});

export const AuthMessageSchema = z.union([
  AuthChallengeSchema,
  AuthPluginProofSchema,
  AuthServerProofSchema,
  AuthRejectedSchema,
]);
export type AuthMessage = z.infer<typeof AuthMessageSchema>;

