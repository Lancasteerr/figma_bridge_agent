import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio';

import { PluginConnectionBroker } from './bridge/plugin-connection.js';
import type { ServerConfig } from './config/store.js';
import { registerReadTools } from './mcp/register-read-tools.js';
import { registerMediaTools } from './mcp/register-media-tools.js';
import { registerLayoutTools } from './mcp/register-layout-tools.js';
import { registerMutationTools } from './mcp/register-mutation-tools.js';
import { registerStatusTool } from './mcp/register-status.js';
import { TempAssetStore } from './temp/asset-store.js';

export interface RunningServer {
  broker: PluginConnectionBroker;
  close(): Promise<void>;
}

export async function startServer(config: ServerConfig): Promise<RunningServer> {
  const broker = new PluginConnectionBroker(config);
  const assets = new TempAssetStore();
  await assets.initialize();
  await broker.start();

  let handle: StdioServerHandle | undefined;
  handle = serveStdio(
    () => {
      const server = new McpServer({ name: 'figma-local-agent', version: '0.1.0' });
      registerStatusTool(server, broker);
      registerReadTools(server, broker);
      registerMediaTools(server, broker, assets);
      registerMutationTools(server, broker);
      registerLayoutTools(server, broker);
      return server;
    },
    { onerror: (error) => console.error(JSON.stringify({ level: 'error', message: error.message })) },
  );

  return {
    broker,
    async close() {
      await handle?.close();
      await broker.stop();
      await assets.close();
    },
  };
}
