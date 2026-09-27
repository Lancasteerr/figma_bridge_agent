import { createHmac, timingSafeEqual } from 'node:crypto';

const PLUGIN_CONTEXT = 'figma-agent/plugin/v1';
const SERVER_CONTEXT = 'figma-agent/server/v1';

/** secret 以 base64url 保存，解码后作为 HMAC-SHA256 的 256-bit key 使用。 */
function hmac(secret: string, value: string): string {
  return createHmac('sha256', Buffer.from(secret, 'base64url')).update(value).digest('base64url');
}

/** 生成插件方向 proof；context 区分方向，防止把 server proof 复用于插件 proof。 */
export function createPluginProof(
  secret: string,
  serverNonce: string,
  pluginNonce: string,
): string {
  return hmac(secret, `${PLUGIN_CONTEXT}|${serverNonce}|${pluginNonce}`);
}

/** 生成服务端方向 proof，供插件确认服务端掌握同一配对密钥。 */
export function createServerProof(
  secret: string,
  serverNonce: string,
  pluginNonce: string,
): string {
  return hmac(secret, `${SERVER_CONTEXT}|${serverNonce}|${pluginNonce}`);
}

/** 先比较长度再使用 timingSafeEqual，避免不同长度输入触发异常。 */
export function verifyProof(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}
