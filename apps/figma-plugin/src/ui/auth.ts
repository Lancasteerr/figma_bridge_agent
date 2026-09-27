import { hmac as createHmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';

const encoder = new TextEncoder();

/** 将 base64url secret 解码为 HMAC 使用的原始字节。 */
function decodeBase64Url(value: string): Uint8Array {
  const padded = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

/** 浏览器侧使用 base64url 传递 nonce 和 proof，和 Node crypto 输出保持一致。 */
function encodeBase64Url(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 使用纯 JavaScript HMAC-SHA256，兼容未暴露 crypto.subtle 的 Figma UI 沙箱。 */
function hmac(secret: string, value: string): string {
  return encodeBase64Url(createHmac(sha256, decodeBase64Url(secret), encoder.encode(value)));
}

/** 生成 24 字节随机插件 nonce，用于绑定单次连接握手。 */
export function randomNonce(): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(24)));
}

/** 生成插件方向 proof；context 必须与服务端实现完全一致。 */
export async function createPluginProof(
  secret: string,
  serverNonce: string,
  pluginNonce: string,
): Promise<string> {
  return hmac(secret, `figma-agent/plugin/v1|${serverNonce}|${pluginNonce}`);
}

/** 生成服务端方向 proof，供插件验证服务端而非只验证自身请求。 */
export async function createServerProof(
  secret: string,
  serverNonce: string,
  pluginNonce: string,
): Promise<string> {
  return hmac(secret, `figma-agent/server/v1|${serverNonce}|${pluginNonce}`);
}

/** 逐字符比较 proof，避免直接使用可能泄漏长度差异的普通比较。 */
export function equalProof(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}
