# figma-local-agent-mcp

Local-first stdio MCP Server for the **Local Figma Agent Bridge** Figma development plugin.

本地优先的 stdio MCP Server，与 **Local Figma Agent Bridge** Figma 开发插件配合使用。

## Direct MCP installation / 直接安装 MCP

Node.js 20 or newer is required. The MCP package and Figma plugin must use the same version.

需要 Node.js 20 或更高版本。MCP 包与 Figma 插件必须使用相同版本。

Open the [latest GitHub Release](https://github.com/Lancasteerr/figma_bridge_agent/releases/latest), note the version without the `v` prefix, and replace every `<VERSION>` below with it.

打开 [GitHub 最新版本页面](https://github.com/Lancasteerr/figma_bridge_agent/releases/latest)，记下不含 `v` 前缀的版本号，并用它替换下文所有 `<VERSION>`。

Pair once / 首次配对：

```powershell
npx -y figma-local-agent-mcp@<VERSION> pair
```

Then configure a Windows stdio MCP client with command `npx.cmd` and arguments `-y`, `figma-local-agent-mcp@<VERSION>`, `serve`. Claude Code can register it with:

```powershell
claude mcp add --scope user --transport stdio figma-local-agent -- npx.cmd -y figma-local-agent-mcp@<VERSION> serve
```

随后在 Windows stdio MCP 客户端中使用命令 `npx.cmd`，参数依次为 `-y`、`figma-local-agent-mcp@<VERSION>`、`serve`。Claude Code 可以使用：

```powershell
claude mcp add --scope user --transport stdio figma-local-agent -- npx.cmd -y figma-local-agent-mcp@<VERSION> serve
```

Direct MCP configuration has the same workflow activation behavior as the Agent Plugin: cold start exposes only `figma_status` and `figma_activate_workflow`; `INSPECT`, `FRONTEND`, and `DESIGN` expose 9, 13, and 21 tools respectively. Switching uses standard `notifications/tools/list_changed`, which the client must support. Direct installation does not install the workflow Skill automatically. See the [complete direct MCP guide](https://github.com/Lancasteerr/figma_bridge_agent/blob/master/docs/en-US/install-mcp-server.md).

直接配置 MCP 与 Agent Plugin 使用相同的工作流激活机制：冷启动只暴露 `figma_status` 与 `figma_activate_workflow`，`INSPECT`、`FRONTEND`、`DESIGN` 分别暴露 9、13、21 个工具。切换使用标准 `notifications/tools/list_changed`，客户端必须支持该通知。直接安装不会自动安装工作流 Skill。完整步骤见[直接 MCP 指南](https://github.com/Lancasteerr/figma_bridge_agent/blob/master/docs/zh-CN/install-mcp-server.md)。

The matching Figma plugin ZIP, Agent Plugin, and complete bilingual documentation are available from the [GitHub repository](https://github.com/Lancasteerr/figma_bridge_agent).

匹配的 Figma 插件 ZIP、Agent Plugin 和完整中英文文档请从 [GitHub 仓库](https://github.com/Lancasteerr/figma_bridge_agent)获取。

This is an unofficial project and is not affiliated with or endorsed by Figma.

本项目为非官方项目，与 Figma 不存在隶属或背书关系。
