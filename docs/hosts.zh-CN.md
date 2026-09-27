# MCP 主机配置

[English](hosts.md)

先执行 `pnpm build`。将每个示例中的 `E:/absolute/path/figma_bridge_agent` 替换为实际路径。

## Codex（验收使用的阻塞式主机）

官方 Codex MCP 文档确认支持本地 stdio 服务器、项目级 `.codex/config.toml`、`command`/`args`/`cwd`、工具超时，以及感知读写操作的审批模式：<https://learn.chatgpt.com/docs/extend/mcp>。

通过 CLI 注册：

```powershell
codex mcp add figma-local-agent -- node E:/absolute/path/figma_bridge_agent/apps/mcp-server/dist/cli.js serve
codex mcp list
```

等价的项目级 `.codex/config.toml`：

```toml
[mcp_servers.figma_local_agent]
command = "node"
args = ["E:/absolute/path/figma_bridge_agent/apps/mcp-server/dist/cli.js", "serve"]
cwd = "E:/absolute/path/figma_bridge_agent"
startup_timeout_sec = 10
tool_timeout_sec = 130
default_tools_approval_mode = "writes"
enabled = true
```

Codex CLI、其 IDE 扩展以及 ChatGPT Desktop Codex 主机共享本地 MCP 配置。修改配置后重启主机，然后调用 `figma_status`。

## Claude Code（配置示例）

项目级 `.mcp.json`：

```json
{
  "mcpServers": {
    "figma-local-agent": {
      "type": "stdio",
      "command": "node",
      "args": ["E:/absolute/path/figma_bridge_agent/apps/mcp-server/dist/cli.js", "serve"],
      "cwd": "E:/absolute/path/figma_bridge_agent"
    }
  }
}
```

## Cursor（配置示例）

项目级 `.cursor/mcp.json`：

```json
{
  "mcpServers": {
    "figma-local-agent": {
      "command": "node",
      "args": ["E:/absolute/path/figma_bridge_agent/apps/mcp-server/dist/cli.js", "serve"]
    }
  }
}
```

Claude Code 和 Cursor 示例采用标准 stdio MCP 配置，但 v0.1 版本的发布验收针对 Codex 执行。主机界面标签和配置发现方式可能发生变化；如果当前版本没有加载该文件，请查阅对应主机的文档。

## 预期的启动行为

- MCP 进程独占 stdout；诊断 JSON 会写入 stderr。
- 每个主机拥有独立的 stdio Adapter。所有 Adapter 共享自动启动的单例 Bridge Daemon，因此多个 Codex 任务或受支持主机可以并发使用同一插件。
- 工具发现始终成功。Daemon 不可用时返回可重试的 `BRIDGE_UNAVAILABLE`；Daemon 已运行但插件未启动时快速返回 `PLUGIN_NOT_CONNECTED`。
- 只有一个插件可以完成身份验证。启动第二个插件窗口会返回 `PLUGIN_ALREADY_CONNECTED`。
- 插件必须保持打开，因为它的 UI 进程支持 WebSocket。

可使用 `node apps/mcp-server/dist/cli.js bridge status|start|stop` 显式管理生命周期。`doctor` 会区分健康 Daemon、已停止 Daemon、升级前的旧版进程和无关端口占用者。

从单进程桥接升级后，需要一次性关闭旧 MCP 任务以释放旧进程占用的 3900 端口，重新构建后再打开任务。主机配置命令无需修改。
