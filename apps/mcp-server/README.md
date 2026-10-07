# figma-local-agent-mcp

Local-first stdio MCP Server for the **Local Figma Agent Bridge** Figma development plugin.

本地优先的 stdio MCP Server，与 **Local Figma Agent Bridge** Figma 开发插件配合使用。

## Install / 安装

Node.js 20 or newer is required. The MCP package and Figma plugin must use the same version.

需要 Node.js 20 或更高版本。MCP 包与 Figma 插件必须使用相同版本。

Pair once / 首次配对：

```powershell
npx -y figma-local-agent-mcp@0.9.0 pair
```

Then configure a Windows MCP client with command `npx.cmd` and arguments `-y`, `figma-local-agent-mcp@0.9.0`, `serve`.

随后在 Windows MCP 客户端中使用命令 `npx.cmd`，参数依次为 `-y`、`figma-local-agent-mcp@0.9.0`、`serve`。

The matching Figma plugin ZIP, Agent Plugin, and complete bilingual documentation are available from the [GitHub repository](https://github.com/Lancasteerr/figma_bridge_agent).

匹配的 Figma 插件 ZIP、Agent Plugin 和完整中英文文档请从 [GitHub 仓库](https://github.com/Lancasteerr/figma_bridge_agent)获取。

This is an unofficial project and is not affiliated with or endorsed by Figma.

本项目为非官方项目，与 Figma 不存在隶属或背书关系。
