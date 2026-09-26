import { createHmac, timingSafeEqual } from 'node:crypto';

const PLUGIN_CONTEXT = 'figma-agent/plugin/v1';
const SERVER_CONTEXT = 'figma-agent/server/v1';

function hmac(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function createPluginProof(secret: string, serverNonce: string, pluginNonce: string): string {
  return hmac(secret, `${PLUGIN_CONTEXT}|${serverNonce}|${pluginNonce}`);
}

export function createServerProof(secret: string, serverNonce: string, pluginNonce: string): string {
  return hmac(secret, `${SERVER_CONTEXT}|${serverNonce}|${pluginNonce}`);
}

export function verifyProof(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

