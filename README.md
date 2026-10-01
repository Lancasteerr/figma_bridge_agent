# Local Figma Agent MCP

[中文文档](README.zh-CN.md)

Local-first MCP server and Figma Desktop development plugin for reading Figma Design documents and making reviewable changes in isolated Proposal copies.

This is an unofficial GitHub-distributed development tool. It is not affiliated with or endorsed by Figma, and it is not published through Figma Community. Figma files and credentials remain on the local loopback connection; there is no cloud relay or telemetry.

## Windows quick start

Requirements: Windows, Node.js 20 or newer, Figma Desktop, and a coding agent with stdio MCP support. Git, pnpm, and a source checkout are not required.

1. Download `figma-agent-bridge-plugin-v0.2.0.zip` from [GitHub Releases](https://github.com/Lancasteerr/figma_bridge_agent/releases), extract it to a stable folder, then choose **Figma Desktop → Plugins → Development → Import plugin from manifest** and select `figma-agent-bridge-plugin/manifest.json`.
2. Start **Local Figma Agent Bridge** in Figma. In PowerShell run:

   ```powershell
   npx -y figma-local-agent-mcp@0.2.0 pair
   ```

3. Compare the six-digit code in PowerShell and the plugin. Click **Codes match** only when they are identical.
4. Configure the coding agent to run the stdio server:

   ```json
   {
     "command": "npx.cmd",
     "args": ["-y", "figma-local-agent-mcp@0.2.0", "serve"]
   }
   ```

The plugin reconnects automatically after the first pairing. Keep its window open while using the bridge. See [host-specific examples](docs/hosts.md) for Codex, ChatGPT Desktop, Claude Code/Desktop, and generic MCP clients.

## Development builds

Every successful update to `master` publishes a rolling [Development build](https://github.com/Lancasteerr/figma_bridge_agent/releases/tag/development) prerelease. It contains the latest plugin ZIP, MCP tarball, checksums, commit, and build information.

These builds are untested development snapshots, not official stable releases. Download the plugin ZIP and MCP tarball from the same Development build, then follow the normal installation path:

1. Extract `figma-agent-bridge-plugin-development.zip` and import `figma-agent-bridge-plugin/manifest.json` in Figma Desktop.
2. From the directory containing the tarball, run:

   ```powershell
   npx -y ./figma-local-agent-mcp-development.tgz pair
   ```

3. Configure the MCP host with `npx.cmd`, `-y`, `./figma-local-agent-mcp-development.tgz`, and `serve`.

Do not mix a development plugin with a stable MCP package, or vice versa. See the [latest stable release](https://github.com/Lancasteerr/figma_bridge_agent/releases/latest) for production use.

## Update and recovery

- Install matching plugin and npm versions. To update, overwrite the extracted plugin folder with the new ZIP and update the version in the MCP configuration.
- `npx -y figma-local-agent-mcp@0.2.0 doctor` checks the local service without revealing credentials.
- `npx -y figma-local-agent-mcp@0.2.0 devices list` lists paired devices.
- `devices revoke <deviceId>` or `devices revoke --all` removes credentials. A revoked plugin must pair again.
- Upgrading from v0.1 removes the old shared secret and requires one new pairing. Close all v0.1 MCP tasks first so their old Daemon releases port 3900.

## Safety and tools

The bridge deliberately does not mutate source artwork. Every public write either creates a Proposal or requires a Proposal root ID. Primitive Proposal creation accepts edit targets, resolves a bounded layout context automatically, and moves the clones to the Page before editing; the whole isolated Proposal remains writable. A declarative DesignPlan can also create a complete top-level Frame, text, images, SVG, namespaced local styles/variables, and instances of components already present on the current page. Validation IDs are single-use, expire after five minutes, and all source/resources are re-checked immediately before applying.

It exposes exactly 22 closed-world MCP tools covering status/read, rendering/export, Base64 asset staging, font/resource discovery, Proposal writes, and validated DesignPlans. It never queries Team Library; users first place any library instance on the current page. See [architecture and safety](docs/architecture.md), [security notes](docs/security.md), and the [acceptance runbook](docs/acceptance.md).

## Development

Contributors need pnpm 11:

```powershell
pnpm install
pnpm check
pnpm build:release
```

`pnpm build:release` produces the directly importable plugin ZIP, npm tarball, and `SHA256SUMS` under `artifacts/`. A local `.figma-plugin-id` may override the ID for contributor builds, but release builds always enforce `1685966253180273328`.

Owners should follow the [manual release runbook](docs/releasing.md); no version is published merely by pushing a commit or tag.

Version 0.2 supports multiple local MCP adapters, one active Figma plugin, and the current page of the current Design file. Windows installers, automatic updates, remote transport, cloud sync, arbitrary JavaScript, source-node writes, general deletion, instance detach, and framework-specific code generation are outside this release.
