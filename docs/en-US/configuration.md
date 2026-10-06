# Installation and configuration

[中文版](../zh-CN/configuration.md)

This guide covers three supported configurations: the stable npm release, the rolling Development build, and a build compiled from source. Whichever option you choose, the Figma plugin and MCP Server must come from the same version or the same build. Do not mix them.

## Prerequisites

- Windows
- Node.js 20 or newer (verify with `node --version` and `where.exe npx`)
- Figma Desktop
- A local client that supports stdio MCP servers; remote-only environments such as ChatGPT Web and Codex Cloud cannot reach this computer's loopback bridge
- Git and pnpm 11.19.0 only when building from source

The examples use `figma-local-agent` as the MCP Server name. For a first installation or after changing builds, import the matching plugin and pair it once before restarting the MCP client.

## Option 1: stable npm release (recommended)

The stable MCP Server is published to npm, and its matching plugin is available from the project's [GitHub Releases](https://github.com/Lancasteerr/figma_bridge_agent/releases/latest). Pin an exact version in the configuration instead of using `@latest` permanently. Otherwise, an automatic npm package upgrade can leave the local plugin on a different version.

### 1. Identify and install the matching version

Query the current stable npm version in PowerShell:

```powershell
npm view figma-local-agent-mcp dist-tags.latest
```

Treat the output as `<VERSION>`. Download `figma-agent-bridge-plugin-v<VERSION>.zip` from the corresponding `v<VERSION>` GitHub Release, extract it to a directory that will not be moved or deleted, then select **Figma Desktop → Plugins → Development → Import plugin from manifest** and open:

```text
figma-agent-bridge-plugin/manifest.json
```

### 2. Pair the plugin

Start **Local Figma Agent Bridge** in Figma, then run the following command after replacing `<VERSION>` with the version found above:

```powershell
npx -y figma-local-agent-mcp@<VERSION> pair
```

The terminal and plugin each display a six-digit code. Click **Codes match** in the plugin only when both codes are identical.

### 3. Install the portable Agent Plugin (recommended)

Agent Plugins 1.0 clients can import the version-pinned repository instead of maintaining an MCP configuration manually. For Codex CLI and ChatGPT desktop, add the repository marketplace and install its single plugin:

```powershell
codex plugin marketplace add Lancasteerr/figma_bridge_agent --ref v0.9.0
codex plugin add figma-local-agent@figma-local-agent
```

Restart ChatGPT desktop or start a new Codex session after installation. The plugin's `mcp.json` starts `figma-local-agent-mcp@0.9.0` through stdio and its Skill teaches the agent the safe Proposal workflow. Other compatible clients can import `plugins/figma-local-agent` from tag `v0.9.0` according to their Agent Plugins installation UI.

### 4. Manual MCP fallback

Use the following only when the client cannot install Agent Plugins 1.0.

Project-level `.codex/config.toml` for Codex:

```toml
[mcp_servers.figma_local_agent]
command = "npx.cmd"
args = ["-y", "figma-local-agent-mcp@<VERSION>", "serve"]
startup_timeout_sec = 15
tool_timeout_sec = 130
enabled = true
```

You can also register it with the Codex CLI:

```powershell
codex mcp add figma-local-agent -- npx.cmd -y figma-local-agent-mcp@<VERSION> serve
```

Claude Code, Claude Desktop, Cursor, and other stdio-compatible MCP clients can use:

```json
{
  "mcpServers": {
    "figma-local-agent": {
      "type": "stdio",
      "command": "npx.cmd",
      "args": ["-y", "figma-local-agent-mcp@<VERSION>", "serve"]
    }
  }
}
```

Use `npx.cmd`, not `npx`, in Windows GUI applications. Restart the MCP client after saving the configuration.

## Option 2: Development build

The [Development build](https://github.com/Lancasteerr/figma_bridge_agent/releases/tag/development) is refreshed after each successful build of the `master` branch. It is intended for testing the newest changes and is not recommended where stability is required. Because this Release rolls forward, download the plugin ZIP and MCP tarball together in the same session.

### 1. Download and verify the build

Download all three files:

- `figma-agent-bridge-plugin-development.zip`
- `figma-local-agent-mcp-development.tgz`
- `SHA256SUMS`

You can inspect the local SHA-256 values in PowerShell and compare them with `SHA256SUMS`:

```powershell
Get-FileHash .\figma-agent-bridge-plugin-development.zip -Algorithm SHA256
Get-FileHash .\figma-local-agent-mcp-development.tgz -Algorithm SHA256
```

Extract the ZIP to a stable directory and import its `figma-agent-bridge-plugin/manifest.json` into Figma Desktop. Keep the `.tgz` in a fixed directory as well, for example `C:/Tools/figma-agent/`.

### 2. Pair with the local tarball

Start the plugin in Figma, then pair with the actual absolute path to the tarball. Declare the local package explicitly with `--package=file:...`, and name the package CLI after `--`:

```powershell
npm exec --yes --package="file:C:/Tools/figma-agent/figma-local-agent-mcp-development.tgz" -- figma-local-agent-mcp pair
```

Do not use an npm pairing command that may be displayed in the plugin UI. A Development build must always use the local tarball downloaded from the same build.

> **Do not use** `npx -y "C:/Tools/figma-agent/figma-local-agent-mcp-development.tgz" pair`. When an existing file path is the first positional argument to `npx`, npm may identify it as the command to execute instead of a package to install. Windows then opens the file through its `.tgz` file association. The explicit [`npm exec --package=<pkg> -- <cmd>`](https://docs.npmjs.com/cli/v11/commands/npm-exec/) form avoids this ambiguity.

### 3. Configure the MCP client

Project-level `.codex/config.toml` for Codex:

```toml
[mcp_servers.figma_local_agent]
command = "npm.cmd"
args = ["exec", "--yes", "--package=file:C:/Tools/figma-agent/figma-local-agent-mcp-development.tgz", "--", "figma-local-agent-mcp", "serve"]
startup_timeout_sec = 15
tool_timeout_sec = 130
enabled = true
```

Generic stdio JSON:

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

Use an absolute path because a GUI application's working directory is generally not the directory containing the tarball. When updating the Development build, replace both the plugin directory and tarball, then restart the Figma plugin and MCP client.

## Option 3: build from source

Building from source is intended for development, debugging, or source review. The recommended approach is to run the generated CLI bundle directly and import the plugin generated by the same build. Do not point the MCP Server at one commit and the plugin at another.

### 1. Get the source and dependencies

```powershell
git clone https://github.com/Lancasteerr/figma_bridge_agent.git
Set-Location figma_bridge_agent
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
```

If you already have a checkout, enter the repository and make sure its dependencies match the current `pnpm-lock.yaml`.

### 2. Check and generate local artifacts

```powershell
pnpm build:release
```

This command runs type checking, linting, format checking, tests, and builds. The primary artifacts for direct local use are:

```text
apps/mcp-server/dist/cli.js
apps/figma-plugin/dist/manifest.json
```

It also generates these release-format files under `artifacts/`:

```text
figma-agent-bridge-plugin-v<VERSION>.zip
figma-local-agent-mcp-<VERSION>.tgz
figma-local-agent-plugin-v<VERSION>.zip
SHA256SUMS
```

`<VERSION>` comes from `apps/figma-plugin/package.json` and `apps/mcp-server/package.json`; the build requires the two versions to match exactly.

### 3. Import, pair, and configure

You can import `apps/figma-plugin/dist/manifest.json` directly into Figma Desktop, or extract the plugin ZIP and import its `figma-agent-bridge-plugin/manifest.json`. Then pair by running the compiled CLI directly with Node.js from the repository root:

```powershell
node .\apps\mcp-server\dist\cli.js pair
```

Use the absolute path to `dist/cli.js` in the MCP client configuration. If the repository is located at `E:/codes/figma_bridge_agent`:

```toml
[mcp_servers.figma_local_agent]
command = "node.exe"
args = ["E:/codes/figma_bridge_agent/apps/mcp-server/dist/cli.js", "serve"]
startup_timeout_sec = 15
tool_timeout_sec = 130
enabled = true
```

Equivalent generic stdio JSON:

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

After switching commits or rebuilding, run `pnpm build:release` again and reload or replace the plugin. The `dist/cli.js` path does not change with the version number, so the MCP configuration does not need to change after each build. For continuous plugin-only development, you may run `pnpm --filter @figma-agent/figma-plugin dev`; return to the `pnpm build:release` artifacts for release-like validation.

If you specifically need to test the release-format `.tgz`, use the explicit `npm exec --package=file:... -- figma-local-agent-mcp` form from the Development build section. Do not pass the `.tgz` path directly as a positional argument to `npx`.

## Verification and troubleshooting

Run `doctor` from the same source used by your current installation. For example, for a stable npm release:

```powershell
npx -y figma-local-agent-mcp@<VERSION> doctor
```

For a local tarball:

```powershell
npm exec --yes --package="file:C:/Tools/figma-agent/figma-local-agent-mcp-development.tgz" -- figma-local-agent-mcp doctor
```

For a source build:

```powershell
node .\apps\mcp-server\dist\cli.js doctor
```

After configuration, verify that:

1. **Local Figma Agent Bridge** is open in Figma and its plugin window remains open.
2. The MCP client discovers tools such as `figma_status`.
3. Calling `figma_status` returns the current Figma document, page, and selection.

Common problems:

- `PLUGIN_NOT_CONNECTED`: the Figma plugin is closed or unpaired, or it does not match the MCP Server build.
- `npx.cmd` is not found: restart the MCP client after installing Node.js 20+, then check PATH with `where.exe npx`.
- The local `.tgz` is missing: it was moved or deleted, or `--package=file:...` in the configuration uses the wrong path. Restore it or update the configuration with the correct absolute path.
- Starting MCP opens the `.tgz` on the desktop: the configuration still uses the positional `npx <tarball>` form. Replace it with the documented `npm.cmd exec --package=file:... -- figma-local-agent-mcp serve` form.
- Port 3900 is held by an old process: close MCP client tasks using the old version, then run `doctor` again.
- Automatic reconnection fails after an update: confirm that both the plugin and MCP Server were updated; run `pair` again if necessary.

See [host configuration](hosts.md) for more client examples and [security notes](security.md) for the security boundaries.
