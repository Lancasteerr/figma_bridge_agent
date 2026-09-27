import { MAX_RPC_MESSAGE_BYTES } from '@figma-agent/protocol';
import { WebSocket, WebSocketServer } from 'ws';

import type { ServerConfig } from '../config/store.js';
import type { PluginConnectionBroker } from './plugin-connection.js';

/** 只负责监听插件 WebSocket；鉴权与 RPC 生命周期由 Broker 管理。 */
export class PluginGateway {
  readonly #config: ServerConfig;
  readonly #broker: PluginConnectionBroker;
  readonly #sockets = new Set<WebSocket>();
  #server: WebSocketServer | undefined;

  constructor(config: ServerConfig, broker: PluginConnectionBroker) {
    this.#config = config;
    this.#broker = broker;
  }

  async start(): Promise<void> {
    if (this.#server) return;
    const server = new WebSocketServer({
      host: this.#config.host,
      port: this.#config.port,
      maxPayload: MAX_RPC_MESSAGE_BYTES,
      perMessageDeflate: false,
    });
    this.#server = server;
    server.on('connection', (socket) => {
      this.#sockets.add(socket);
      socket.once('close', () => this.#sockets.delete(socket));
      this.#broker.accept(socket);
    });
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
  }

  async close(): Promise<void> {
    const server = this.#server;
    this.#server = undefined;
    if (!server) return;
    for (const socket of this.#sockets) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
