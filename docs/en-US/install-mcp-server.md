# Configure the MCP Server directly

[中文版](../zh-CN/install-mcp-server.md) · [Choose an installation method](configuration.md) · [Documentation home](README.md)

This guide is for Claude Code, Claude Desktop, and other clients that can start a local stdio MCP Server on Windows. Direct configuration exposes the same 23 MCP tools as the Agent Plugin, but it does not automatically install the workflow Skill under `plugins/figma-local-agent/skills/`.

Claude Code has its own plugin system, but this project does not currently publish a matching plugin marketplace entry. The recommended integration is therefore the direct stdio configuration on this page. This is a first-class installation method, not a degraded fallback.

## Requirements

- Windows
- Node.js 20 or newer
- Figma Desktop
- A client that supports local stdio MCP servers

Windows GUI applications should use `npx.cmd`, not `npx`. Every stable example below is pinned to `0.9.0`, and the MCP npm package must remain on the same version as the Figma plugin.

## Stable installation

### 1. Import the matching Figma plugin

Download `figma-agent-bridge-plugin-v0.9.0.zip` from the [v0.9.0 GitHub Release](https://github.com/Lancasteerr/figma_bridge_agent/releases/tag/v0.9.0) and extract it to a directory that will not be moved or deleted.

In **Figma Desktop → Plugins → Development → Import plugin from manifest**, select:

```text
figma-agent-bridge-plugin/manifest.json
```

### 2. Complete first-time pairing

Start **Local Figma Agent Bridge** in Figma, keep its window open, and run in PowerShell:

```powershell
npx -y figma-local-agent-mcp@0.9.0 pair
```

Click **Codes match** only when the six-digit codes shown by the terminal and plugin are identical. Pairing initializes the Figma plugin and local Bridge; it does not write configuration into the MCP client.

### 3. Add the stdio MCP Server

Choose only the method for your current client.

#### Claude Code

Add a user-scoped Server:

```powershell
claude mcp add --scope user --transport stdio figma-local-agent -- npx.cmd -y figma-local-agent-mcp@0.9.0 serve
claude mcp get figma-local-agent
```

To share the configuration with a project team, commit `.mcp.json` at the project root:

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

Claude Code asks each user to trust a project-scoped `.mcp.json` Server when it is first loaded.

#### Claude Desktop

Add this entry to the Claude Desktop custom MCP configuration:

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

#### Codex CLI and desktop

Register through the CLI:

```powershell
codex mcp add figma-local-agent -- npx.cmd -y figma-local-agent-mcp@0.9.0 serve
codex mcp list
```

Equivalent project-level `.codex/config.toml`:

```toml
[mcp_servers.figma_local_agent]
command = "npx.cmd"
args = ["-y", "figma-local-agent-mcp@0.9.0", "serve"]
startup_timeout_sec = 15
tool_timeout_sec = 130
enabled = true
```

Do not use this direct configuration when the Agent Plugin is already installed, or the tools will be loaded twice.

#### Cursor and other stdio hosts

Add this entry in the client's MCP settings:

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

The exact settings file and UI label depend on the host. Remote-only environments such as ChatGPT Web and Codex Cloud cannot reach the local Bridge.

### 4. Restart and verify

Restart the MCP client or open a new session after saving the configuration. Then:

1. Confirm the client loads only one `figma-local-agent` Server.
2. Confirm all 23 tools, including `figma_status`, are discoverable.
3. Call `figma_status` and check protocol v4, the current Figma file, page, selection, and Bridge capabilities.

Direct configuration does not automatically load the Agent Plugin Skill. Read the [MCP tool reference](tools.md), especially the Proposal and DesignPlan workflows, before performing writes.

## Development build

The rolling [Development Release](https://github.com/Lancasteerr/figma_bridge_agent/releases/tag/development) is a testing build that provides only a Figma plugin ZIP and MCP tarball, not an Agent Plugin. Download these files together from the same run:

- `figma-agent-bridge-plugin-development.zip`
- `figma-local-agent-mcp-development.tgz`
- `SHA256SUMS`

After verifying the files, extract the Figma ZIP and import `figma-agent-bridge-plugin/manifest.json`. Keep the `.tgz` at a stable absolute path such as `C:/Tools/figma-agent/`.

Pair with:

```powershell
npm exec --yes --package="file:C:/Tools/figma-agent/figma-local-agent-mcp-development.tgz" -- figma-local-agent-mcp pair
```

Generic stdio configuration:

```json
{
  "mcpServers": {
    "figma-local-agent": {
      "type": "stdio",
      "command": "npm.cmd",
      "args": [
        "exec",
        "--yes",
        "--package=file:C:/Tools/figma-agent/figma-local-agent-mcp-development.tgz",
        "--",
        "figma-local-agent-mcp",
        "serve"
      ]
    }
  }
}
```

Do not use `npx -y <tarball> pair`. npm can treat an existing `.tgz` path as the command to execute and cause Windows to open the file. When updating a Development build, replace both the Figma plugin directory and tarball.

## Run from source

Source builds are intended for development, debugging, and auditing:

```powershell
git clone https://github.com/Lancasteerr/figma_bridge_agent.git
Set-Location figma_bridge_agent
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
pnpm build:release
```

Import `apps/figma-plugin/dist/manifest.json` in Figma Desktop, then pair from the repository root:

```powershell
node .\apps\mcp-server\dist\cli.js pair
```

Configure the MCP client with the absolute path to `dist/cli.js`. For a repository at `E:/codes/figma_bridge_agent`:

```json
{
  "mcpServers": {
    "figma-local-agent": {
      "type": "stdio",
      "command": "node.exe",
      "args": ["E:/codes/figma_bridge_agent/apps/mcp-server/dist/cli.js", "serve"]
    }
  }
}
```

After switching commits or rebuilding, reload or replace the Figma plugin. Never mix a Server from one commit with a Figma plugin from another.

## Troubleshooting

- Stable release: run `npx -y figma-local-agent-mcp@0.9.0 doctor`.
- Development tarball: run `npm exec --yes --package="file:C:/Tools/figma-agent/figma-local-agent-mcp-development.tgz" -- figma-local-agent-mcp doctor`.
- Source build: run `node .\apps\mcp-server\dist\cli.js doctor`.
- `PLUGIN_NOT_CONNECTED`: the Figma plugin is closed, not paired, or from a different build than the Server.
- `npx.cmd` not found: restart the client after installing Node.js 20+ and run `where.exe npx` to inspect `PATH`.
- Duplicate tools: both the Agent Plugin and a direct MCP configuration are enabled; keep only one.
- Port 3900 already in use: close stale MCP client processes and run `doctor` again.
