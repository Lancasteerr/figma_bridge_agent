import { hmac as createHmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';

const encoder = new TextEncoder();

export function decodeBase64Url(value: string): Uint8Array {
  const padded = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

export function encodeBase64Url(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function hmac(secret: string, value: string): string {
  return encodeBase64Url(createHmac(sha256, decodeBase64Url(secret), encoder.encode(value)));
}

export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function randomNonce(): string {
  return encodeBase64Url(randomBytes(24));
}

/** 不依赖 crypto.randomUUID，兼容 Figma UI 的精简浏览器环境。 */
export function randomUuid(): string {
  const bytes = randomBytes(16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createPluginProof(
  token: string,
  serverId: string,
  deviceId: string,
  serverNonce: string,
  pluginNonce: string,
): string {
  return hmac(token, `figma-agent/plugin/v2|${serverId}|${deviceId}|${serverNonce}|${pluginNonce}`);
}

export function createServerProof(
  token: string,
  serverId: string,
  deviceId: string,
  serverNonce: string,
  pluginNonce: string,
): string {
  return hmac(token, `figma-agent/server/v2|${serverId}|${deviceId}|${serverNonce}|${pluginNonce}`);
}

export function equalProof(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}
