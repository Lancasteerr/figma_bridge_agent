import { connect } from 'node:net';

import type { ServerConfig } from './store.js';

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

