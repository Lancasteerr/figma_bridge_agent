# Choose an installation method

[中文版](../zh-CN/configuration.md) · [Documentation home](README.md)

Local Figma Agent has two first-class installation methods. Both connect the same local stdio MCP Server, expose the same 23 tools, and require the matching Figma development plugin to be imported and paired once. They differ only in how the MCP host receives the Server configuration and workflow guidance.

| Installation method                                        | Intended clients                                         | MCP configuration      | Workflow Skill              | Supported channels                     |
| ---------------------------------------------------------- | -------------------------------------------------------- | ---------------------- | --------------------------- | -------------------------------------- |
| [Install the Agent Plugin](install-plugin.md)              | Currently adapted for Codex, Cursor, and GitHub Copilot  | Supplied by the plugin | Included automatically      | Stable release                         |
| [Configure the MCP Server directly](install-mcp-server.md) | Claude Code, Claude Desktop, and other local stdio hosts | Added manually         | Not installed automatically | Stable, Development, and source builds |

## How to choose

- If the client supports one of this project's existing Agent Plugin entry points, prefer [installing the Agent Plugin](install-plugin.md). It supplies both a version-pinned MCP launch configuration and the safe Proposal workflow Skill. Do not register the same MCP Server manually as well.
- If the client does not have an adapted plugin entry point for this project, or you want explicit control of the launch command, [configure the MCP Server directly](install-mcp-server.md). Claude Code has its own plugin system, but this project does not currently publish a matching marketplace entry, so the documented route is direct stdio configuration.
- Development and source builds are advanced testing paths documented only in the direct MCP guide. The rolling Development Release does not currently publish an Agent Plugin.

## Shared requirements

- Windows
- Node.js 20 or newer
- Figma Desktop
- A client that can start a local stdio MCP Server

The Figma plugin, MCP npm package, and Agent Plugin must come from the same version or the same build. Remote-only environments such as ChatGPT Web and Codex Cloud cannot reach the local loopback Bridge.

After installation, see the [MCP tool reference](tools.md) and [security notes](security.md). If you intend to modify the source, read the [development guide](development.md).
