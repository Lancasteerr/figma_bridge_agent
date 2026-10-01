import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio';

import { DaemonBridgeClient } from './bridge/daemon-client.js';
import type { BridgeTransport } from './bridge/transport.js';
import type { ServerConfig } from './config/store.js';
import { registerReadTools } from './mcp/register-read-tools.js';
import { registerMediaTools } from './mcp/register-media-tools.js';
import { registerDesignTools } from './mcp/register-design-tools.js';
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
  registerDesignTools(server, broker);
  return server;
}

/** 初始化每任务资源并立即注册 MCP；Daemon 连接失败不会让工具集合消失。 */
export async function startServer(config: ServerConfig): Promise<RunningServer> {
  const broker = new DaemonBridgeClient(config);
  const assets = new TempAssetStore();
  await assets.initialize();
  broker.start();

  const handle: StdioServerHandle = serveStdio(() => createMcpServer(broker, assets), {
    onerror: (error) => console.error(JSON.stringify({ level: 'error', message: error.message })),
  });

  return {
    broker,
    async close() {
      await handle?.close();
      await broker.close();
      await assets.close();
    },
  };
}
