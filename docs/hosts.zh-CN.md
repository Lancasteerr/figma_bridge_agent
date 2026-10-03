# Windows MCP 主机配置

[English](hosts.md)

支持 Agent Plugins 1.0 的客户端应优先使用主 README 中的仓库 marketplace 流程。本页是无法安装可移植 Agent Plugin 时的手动 fallback。所有主机都运行同一个 stdio 命令，npm 包版本必须与下载的 Figma 插件 ZIP 版本一致：

```json
{
  "command": "npx.cmd",
  "args": ["-y", "figma-local-agent-mcp@0.9.0", "serve"]
}
```

Windows GUI 应用优先使用 `npx.cmd`。如果找不到命令，请在安装 Node.js 20+ 后重启应用，并在 PowerShell 中运行 `where.exe npx` 检查 PATH。

## Codex CLI 与桌面版

CLI 注册：

```powershell
codex mcp add figma-local-agent -- npx.cmd -y figma-local-agent-mcp@0.9.0 serve
codex mcp list
```

等价的项目级 `.codex/config.toml`：

```toml
[mcp_servers.figma_local_agent]
command = "npx.cmd"
args = ["-y", "figma-local-agent-mcp@0.9.0", "serve"]
startup_timeout_sec = 15
tool_timeout_sec = 130
enabled = true
```

Codex 桌面版使用相同的本地 MCP 服务结构。如果当前版本没有导入 CLI 配置，可在其 MCP 设置中填写相同命令和参数。

## Claude Code 与 Claude Desktop

Claude Code 项目级 `.mcp.json` 和 Claude Desktop 自定义 stdio 条目均可使用：

```json
{
  "mcpServers": {
    "figma-local-agent": {
      "type": "stdio",
      "command": "npx.cmd",
      "args": ["-y", "figma-local-agent-mcp@0.9.0", "serve"]
    }
  }
}
```

## ChatGPT Desktop 与其他 MCP 主机

如果主机提供“添加本地/自定义 MCP 服务”界面，选择 stdio 并填写：

- 名称：`figma-local-agent`
- 命令：`npx.cmd`
- 参数：`-y`、`figma-local-agent-mcp@0.9.0`、`serve`

DeepSeek Harness、Cursor 和其他标准 stdio MCP 主机可使用同一 JSON。具体配置文件位置和界面名称由对应主机决定，可能随版本变化。ChatGPT Web、Codex Cloud 等纯远程主机无法访问本机 Bridge。

## 预期行为

- 每个主机启动一个轻量 stdio Adapter；所有 Adapter 复用同一个已认证 loopback Daemon。
- MCP stdout 只承载协议流量，诊断写入 stderr 或有限大小的本地 Daemon 日志。
- 未打开 Figma 插件时仍能发现工具，但调用会返回 `PLUGIN_NOT_CONNECTED`。
- 同一时间只允许一个活动插件窗口，第二个会收到 `PLUGIN_ALREADY_CONNECTED`。
- `doctor`、`devices list` 和 `devices revoke` 均为本地管理命令，绝不会输出凭据。
