# figma-local-agent-mcp

Local-first stdio MCP Server for the **Local Figma Agent Bridge** Figma development plugin.

本地优先的 stdio MCP Server，与 **Local Figma Agent Bridge** Figma 开发插件配合使用。

## Direct MCP installation / 直接安装 MCP

Node.js 20 or newer is required. The MCP package and Figma plugin must use the same version.

需要 Node.js 20 或更高版本。MCP 包与 Figma 插件必须使用相同版本。

Pair once / 首次配对：

```powershell
npx -y figma-local-agent-mcp@0.9.0 pair
```

Then configure a Windows stdio MCP client with command `npx.cmd` and arguments `-y`, `figma-local-agent-mcp@0.9.0`, `serve`. Claude Code can register it with:

```powershell
claude mcp add --scope user --transport stdio figma-local-agent -- npx.cmd -y figma-local-agent-mcp@0.9.0 serve
```

随后在 Windows stdio MCP 客户端中使用命令 `npx.cmd`，参数依次为 `-y`、`figma-local-agent-mcp@0.9.0`、`serve`。Claude Code 可以使用：

```powershell
claude mcp add --scope user --transport stdio figma-local-agent -- npx.cmd -y figma-local-agent-mcp@0.9.0 serve
```

Direct MCP configuration exposes the same 23 tools as the Agent Plugin, but does not install its workflow Skill automatically. See the [complete direct MCP guide](https://github.com/Lancasteerr/figma_bridge_agent/blob/v0.9.0/docs/en-US/install-mcp-server.md).

直接配置 MCP 会公开与 Agent Plugin 相同的 23 个工具，但不会自动安装其中的工作流 Skill。完整步骤见[直接 MCP 指南](https://github.com/Lancasteerr/figma_bridge_agent/blob/v0.9.0/docs/zh-CN/install-mcp-server.md)。

The matching Figma plugin ZIP, Agent Plugin, and complete bilingual documentation are available from the [GitHub repository](https://github.com/Lancasteerr/figma_bridge_agent).

匹配的 Figma 插件 ZIP、Agent Plugin 和完整中英文文档请从 [GitHub 仓库](https://github.com/Lancasteerr/figma_bridge_agent)获取。

This is an unofficial project and is not affiliated with or endorsed by Figma.

本项目为非官方项目，与 Figma 不存在隶属或背书关系。
