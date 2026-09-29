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

## Update and recovery

- Install matching plugin and npm versions. To update, overwrite the extracted plugin folder with the new ZIP and update the version in the MCP configuration.
- `npx -y figma-local-agent-mcp@0.2.0 doctor` checks the local service without revealing credentials.
- `npx -y figma-local-agent-mcp@0.2.0 devices list` lists paired devices.
- `devices revoke <deviceId>` or `devices revoke --all` removes credentials. A revoked plugin must pair again.
- Upgrading from v0.1 removes the old shared secret and requires one new pairing. Close all v0.1 MCP tasks first so their old Daemon releases port 3900.

## Safety and tools

The bridge deliberately does not mutate source artwork. Every public write either creates a Proposal or requires a Proposal root ID. Declarative layout changes use a five-minute, single-use validation ID and re-check the source fingerprint immediately before cloning.

It exposes exactly 19 closed-world MCP tools covering status/read, rendering/export, Proposal writes, and validated layout plans. See [architecture and safety](docs/architecture.md), [security notes](docs/security.md), and the [acceptance runbook](docs/acceptance.md).

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
