import { createHmac, timingSafeEqual } from 'node:crypto';

const PLUGIN_CONTEXT = 'figma-agent/plugin/v2';
const SERVER_CONTEXT = 'figma-agent/server/v2';
const DAEMON_CLIENT_CONTEXT = 'figma-agent/daemon-client/v2';
const DAEMON_SERVER_CONTEXT = 'figma-agent/daemon-server/v2';

/** secret 以 base64url 保存，解码后作为 HMAC-SHA256 的 256-bit key 使用。 */
function hmac(secret: string, value: string): string {
  return createHmac('sha256', Buffer.from(secret, 'base64url')).update(value).digest('base64url');
}

/** 生成插件方向 proof；context 区分方向，防止把 server proof 复用于插件 proof。 */
export function createPluginProof(
  secret: string,
  serverId: string,
  deviceId: string,
  serverNonce: string,
  pluginNonce: string,
): string {
  return hmac(secret, `${PLUGIN_CONTEXT}|${serverId}|${deviceId}|${serverNonce}|${pluginNonce}`);
}

/** 生成服务端方向 proof，供插件确认服务端掌握同一配对密钥。 */
export function createServerProof(
  secret: string,
  serverId: string,
  deviceId: string,
  serverNonce: string,
  pluginNonce: string,
): string {
  return hmac(secret, `${SERVER_CONTEXT}|${serverId}|${deviceId}|${serverNonce}|${pluginNonce}`);
}

/** MCP 客户端到 Daemon 的 proof 与插件 proof 做域分离，禁止跨角色复用。 */
export function createDaemonClientProof(
  secret: string,
  daemonNonce: string,
  clientNonce: string,
): string {
  return hmac(secret, `${DAEMON_CLIENT_CONTEXT}|${daemonNonce}|${clientNonce}`);
}

/** Daemon 返回独立方向的 proof，供本机 MCP 客户端确认服务身份。 */
export function createDaemonServerProof(
  secret: string,
  daemonNonce: string,
  clientNonce: string,
): string {
  return hmac(secret, `${DAEMON_SERVER_CONTEXT}|${daemonNonce}|${clientNonce}`);
}

/** 先比较长度再使用 timingSafeEqual，避免不同长度输入触发异常。 */
export function verifyProof(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}
