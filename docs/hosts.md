# MCP host configuration

[中文版](hosts.zh-CN.md)

Build first with `pnpm build`. Replace `E:/absolute/path/figma_bridge_agent` in every example.

## Codex (blocking acceptance host)

The official Codex MCP documentation confirms local stdio servers, project-scoped `.codex/config.toml`, `command`/`args`/`cwd`, tool timeouts, and read/write-aware approval modes: <https://learn.chatgpt.com/docs/extend/mcp>.

CLI registration:

```powershell
codex mcp add figma-local-agent -- node E:/absolute/path/figma_bridge_agent/apps/mcp-server/dist/cli.js serve
codex mcp list
```

Equivalent project-scoped `.codex/config.toml`:

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

Codex CLI, its IDE extension, and the ChatGPT desktop Codex host share local MCP configuration. Restart the host after changing the configuration, then call `figma_status`.

## Claude Code (configuration example)

Project `.mcp.json`:

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

## Cursor (configuration example)

Project `.cursor/mcp.json`:

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

Claude Code and Cursor examples express standard stdio MCP configuration, but v0.1 release acceptance is run against Codex. Host UI labels and config discovery can change; check the relevant host documentation if its current version does not load the file.

## Expected startup behavior

- The MCP process owns stdout; diagnostic JSON is written to stderr.
- Each host gets its own stdio adapter. Adapters share one automatically started Bridge Daemon, so several Codex tasks or supported hosts can use the same plugin concurrently.
- Tool discovery always succeeds. A missing Daemon returns retryable `BRIDGE_UNAVAILABLE`; a running Daemon without a plugin returns `PLUGIN_NOT_CONNECTED` promptly.
- Only one plugin can authenticate. Starting a second plugin window returns `PLUGIN_ALREADY_CONNECTED`.
- The plugin must remain open because its UI is the WebSocket-capable process.

Use `node apps/mcp-server/dist/cli.js bridge status|start|stop` for explicit lifecycle management. `doctor` distinguishes a healthy Daemon, a stopped Daemon, a pre-Daemon legacy process, and an unrelated port owner.

After upgrading from the single-process bridge, close old MCP tasks once so the legacy process releases port 3900, rebuild, and reopen the tasks. The host configuration command does not change.
