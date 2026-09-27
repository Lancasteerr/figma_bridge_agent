import { connect } from 'node:net';

import type { ServerConfig } from './store.js';

/** 通过一次 TCP 连接区分端口已监听和端口可用；超时按可用处理以避免 doctor 卡住。 */
export async function probeBridgePort(config: ServerConfig): Promise<'available' | 'in-use'> {
  return await new Promise((resolve) => {
    const socket = connect({ host: config.host, port: config.port });
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolve('in-use');
    });
    socket.once('error', () => resolve('available'));
    socket.once('timeout', () => {
      socket.destroy();
      resolve('available');
    });
  });
}
