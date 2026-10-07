# MCP host configuration on Windows

[中文版](../zh-CN/hosts.md) · [Documentation home](README.md)

Agent Plugins 1.0 clients should prefer the repository marketplace flow in the main README. This page is the manual fallback for hosts that cannot install the portable Agent Plugin. All hosts run the same stdio command, and the package version must equal the downloaded Figma plugin ZIP version:

```json
{
  "command": "npx.cmd",
  "args": ["-y", "figma-local-agent-mcp@0.9.0", "serve"]
}
```

Use `npx.cmd` in Windows GUI applications. If it is not found, restart the application after installing Node.js 20+ and verify `where.exe npx` in PowerShell.

## Codex CLI and desktop

CLI registration:

```powershell
codex mcp add figma-local-agent -- npx.cmd -y figma-local-agent-mcp@0.9.0 serve
codex mcp list
```

Equivalent project `.codex/config.toml`:

```toml
[mcp_servers.figma_local_agent]
command = "npx.cmd"
args = ["-y", "figma-local-agent-mcp@0.9.0", "serve"]
startup_timeout_sec = 15
tool_timeout_sec = 130
enabled = true
```

The Codex desktop app uses the same local MCP server shape. Add the command and arguments through its MCP settings if the current app version does not import the CLI configuration.

## Claude Code and Claude Desktop

Claude Code project `.mcp.json` and Claude Desktop custom stdio entries use this server object:

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

## ChatGPT Desktop and other MCP hosts

When the host provides an “add local/custom MCP server” form, select stdio and enter:

- Name: `figma-local-agent`
- Command: `npx.cmd`
- Arguments: `-y`, `figma-local-agent-mcp@0.9.0`, `serve`

DeepSeek Harness, Cursor, and other standard stdio MCP hosts can use the same JSON object. Their configuration file locations and UI labels are host-owned and may change. Remote-only hosts such as ChatGPT Web and Codex Cloud cannot reach this local bridge.

## Expected behavior

- Each host starts its own small stdio adapter; all adapters reuse one authenticated loopback daemon.
- MCP stdout contains protocol traffic only. Diagnostics go to stderr or the bounded local daemon log.
- Tool discovery succeeds without Figma. Calls return `PLUGIN_NOT_CONNECTED` until the paired plugin is open.
- Only one Figma plugin window is active at a time; a second receives `PLUGIN_ALREADY_CONNECTED`.
- `doctor`, `devices list`, and `devices revoke` are local management commands and never print credentials.
