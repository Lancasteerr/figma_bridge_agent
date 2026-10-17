import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio';

import { DaemonBridgeClient } from './bridge/daemon-client.js';
import type { BridgeTransport } from './bridge/transport.js';
import type { ServerConfig } from './config/store.js';
import { ExportStore } from './export/export-store.js';
import { FrontendContextStore } from './frontend/frontend-context-store.js';
import { registerReadTools } from './mcp/register-read-tools.js';
import { registerMediaTools } from './mcp/register-media-tools.js';
import { registerDesignTools } from './mcp/register-design-tools.js';
import { registerMutationTools } from './mcp/register-mutation-tools.js';
import { registerStatusTool } from './mcp/register-status.js';
import { registerFrontendTools } from './mcp/register-frontend-tools.js';
import { registerWorkflowActivationTool } from './mcp/register-workflow-tool.js';
import { TemporaryArtifactStore } from './temp/artifact-store.js';
import { SessionWorkspace } from './storage/session-workspace.js';

/** MCP server 运行期间需要同时关闭 stdio、桥接和临时资源。 */
export interface RunningServer {
  broker: BridgeTransport;
  close(): Promise<void>;
}

/** 创建 MCP 工具集合；冷启动仅暴露状态和连接级工作流开关。 */
export function createMcpServer(
  broker: BridgeTransport,
  assets: TemporaryArtifactStore,
  exports: ExportStore,
  contexts = new FrontendContextStore(exports.workspace, {
    pluginVersion: () => broker.pluginVersion,
  }),
): McpServer {
  const server = new McpServer({ name: 'figma-local-agent', version: __CLI_VERSION__ });
  registerStatusTool(server, broker, exports);
  const workflowTools = {
    ...registerReadTools(server, broker, assets),
    ...registerMediaTools(server, broker, assets, exports, contexts),
    ...registerFrontendTools(server, broker, contexts),
    ...registerMutationTools(server, broker),
    ...registerDesignTools(server, broker),
  };
  registerWorkflowActivationTool(server, workflowTools);
  return server;
}

/** 初始化每任务资源并立即注册 MCP；Daemon 连接失败不会让工具集合消失。 */
export async function startServer(config: ServerConfig): Promise<RunningServer> {
  const broker = new DaemonBridgeClient(config);
  const workspace = new SessionWorkspace();
  const assets = new TemporaryArtifactStore({ sessionId: workspace.sessionId });
  const exports = new ExportStore({ workspace });
  const contexts = new FrontendContextStore(workspace, {
    pluginVersion: () => broker.pluginVersion,
  });
  await Promise.all([assets.initialize(), workspace.initialize()]);
  broker.start();

  const handle: StdioServerHandle = serveStdio(
    () => createMcpServer(broker, assets, exports, contexts),
    {
      onerror: (error) => console.error(JSON.stringify({ level: 'error', message: error.message })),
    },
  );

  return {
    broker,
    async close() {
      await handle?.close();
      await broker.close();
      await assets.close();
    },
  };
}
