import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio';

import { PluginConnectionBroker } from './bridge/plugin-connection.js';
import type { BridgeTransport } from './bridge/transport.js';
import type { ServerConfig } from './config/store.js';
import { registerReadTools } from './mcp/register-read-tools.js';
import { registerMediaTools } from './mcp/register-media-tools.js';
import { registerLayoutTools } from './mcp/register-layout-tools.js';
import { registerMutationTools } from './mcp/register-mutation-tools.js';
import { registerStatusTool } from './mcp/register-status.js';
import { TempAssetStore } from './temp/asset-store.js';

/** MCP server 运行期间需要同时关闭 stdio、桥接和临时资源。 */
export interface RunningServer {
  broker: BridgeTransport;
  close(): Promise<void>;
}

/** 创建 MCP 工具集合；工具按读、媒体、Proposal 写入和布局计划分组注册。 */
export function createMcpServer(broker: BridgeTransport, assets: TempAssetStore): McpServer {
  const server = new McpServer({ name: 'figma-local-agent', version: '0.1.0' });
  registerStatusTool(server, broker);
  registerReadTools(server, broker);
  registerMediaTools(server, broker, assets);
  registerMutationTools(server, broker);
  registerLayoutTools(server, broker);
  return server;
}

/** 按依赖顺序初始化资源：临时目录、WebSocket broker，最后才接收 stdio MCP 请求。 */
export async function startServer(config: ServerConfig): Promise<RunningServer> {
  const broker = new PluginConnectionBroker(config);
  const assets = new TempAssetStore();
  await assets.initialize();
  await broker.start();

  const handle: StdioServerHandle = serveStdio(() => createMcpServer(broker, assets), {
    onerror: (error) => console.error(JSON.stringify({ level: 'error', message: error.message })),
  });

  return {
    broker,
    async close() {
      await handle?.close();
      await broker.stop();
      await assets.close();
    },
  };
}
