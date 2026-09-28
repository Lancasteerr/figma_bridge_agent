/**
 * 桥接协议的稳定参数集中存放于此，服务端与插件必须使用同一版本和消息上限。
 */
export const BRIDGE_PROTOCOL_VERSION = 2 as const;
/** 用户显式开启配对窗口后的有效时间。 */
export const PAIRING_SESSION_TTL_MS = 120_000;
/** 单个本地服务允许保存的插件设备上限。 */
export const MAX_PAIRED_CLIENTS = 16;
/** 默认只监听本机，避免桥接端口意外暴露到局域网。 */
export const DEFAULT_BRIDGE_HOST = '127.0.0.1';
/** 本地 WebSocket 桥接的默认端口。 */
export const DEFAULT_BRIDGE_PORT = 3900;
/** 普通 RPC 的默认超时时间；长任务由调用方显式选择更长的超时。 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
/** 布局计划等可能涉及大量 Figma 操作的 RPC 超时时间。 */
export const LONG_REQUEST_TIMEOUT_MS = 60_000;
/** 单条 RPC 消息的硬上限，防止异常 payload 占满内存。 */
export const MAX_RPC_MESSAGE_BYTES = 16 * 1024 * 1024;
