# Local Figma Agent MCP

Let local coding agents read Figma Design documents safely and create reviewable changes in isolated Proposal copies.

[中文](README.md) · [English documentation](docs/en-US/README.md) · [Latest release](https://github.com/Lancasteerr/figma_bridge_agent/releases/latest) · [Report an issue](https://github.com/Lancasteerr/figma_bridge_agent/issues)

> Local-first · No direct source edits · No cloud relay · No telemetry

This unofficial developer tool is distributed through GitHub. It is not affiliated with or endorsed by Figma and is not published to Figma Community. Figma data and bridge credentials stay on the local loopback interface.

## What it does

| Capability             | Description                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| Local reads            | Read the current file, selection, node tree, styles, variables, fonts, and Inspect CSS   |
| Visual inspection      | Render nodes and export PNG or SVG files to an automatically cleaned temporary directory |
| Safe edits             | Clone targets and required layout context, then edit only inside an isolated Proposal    |
| Declarative generation | Validate a complete DesignPlan before atomically creating a new Proposal                 |
| Multi-client reuse     | Share one managed Bridge Daemon across multiple local MCP Adapters                       |

The MCP Server currently exposes 23 bounded tools. See the [MCP tool reference](docs/en-US/tools.md) for the complete list and recommended call sequences.

## Interface preview

### First-time pairing

Before pairing, the plugin shows the PowerShell command. Once pairing begins, the terminal and plugin display a six-digit code for manual comparison.

<p align="center">
  <img src="docs/img/plugin-unpaired.png" width="360" alt="Local Figma Agent Bridge unpaired state" />
  <img src="docs/img/plugin-pairing.png" width="360" alt="Local Figma Agent Bridge six-digit code confirmation" />
</p>

### Connected state

After pairing, the plugin window shows the Bridge connection, current document, and most recent connection time.

<p align="center">
  <img src="docs/img/plugin-connected.png" width="420" alt="Local Figma Agent Bridge connected state" />
</p>

Agent changes appear as an isolated Proposal on the Figma canvas, ready to review beside the source design.

## Quick start

### Requirements

- Windows
- Node.js 20 or newer
- Figma Desktop
- A coding agent with local stdio MCP or Agent Plugins 1.0 support

Regular users do not need Git, pnpm, or a source checkout. Open the [latest GitHub Release](https://github.com/Lancasteerr/figma_bridge_agent/releases/latest), note the version without the `v` prefix, and replace `<VERSION>` below with it. The Figma plugin ZIP, MCP npm package, and Agent Plugin must come from the same version.

### 1. Choose one installation method

Both methods expose the same 23 MCP tools. Choose exactly one:

- **Install the Agent Plugin**: for Codex, Cursor, and GitHub Copilot, which currently have entry points maintained by this project. It automatically supplies the MCP configuration and safe Proposal workflow Skill. Follow the [Agent Plugin installation guide](docs/en-US/install-plugin.md).
- **Configure the MCP Server directly**: for Claude Code, Claude Desktop, and other local stdio hosts. You add the MCP configuration manually, and the Skill is not installed automatically. Follow the [direct MCP installation guide](docs/en-US/install-mcp-server.md).

Do not install the Agent Plugin and manually register the same MCP Server at the same time, or the client may load duplicate tools. See [choose an installation method](docs/en-US/configuration.md) for the complete comparison.

### 2. Import the Figma plugin

Download `figma-agent-bridge-plugin-v<VERSION>.zip` from the [latest GitHub Release](https://github.com/Lancasteerr/figma_bridge_agent/releases/latest) and extract it to a stable directory.

In **Figma Desktop → Plugins → Development → Import plugin from manifest**, select:

```text
figma-agent-bridge-plugin/manifest.json
```

### 3. Complete first-time pairing

Start **Local Figma Agent Bridge** in Figma and keep its window open. Then run this command in PowerShell:

```powershell
npx -y figma-local-agent-mcp@<VERSION> pair
```

Click **Codes match** only when the six-digit codes in the terminal and plugin are identical. After a successful pairing, the plugin authenticates and reconnects automatically on later starts.

### 4. Verify the connection

Restart the MCP client or open a new agent session, then ask the agent to call `figma_status`. A healthy result includes protocol v4, the current Figma file, page, selection, and Bridge capabilities.

For Development builds, source builds, and direct MCP troubleshooting, see the [direct MCP installation guide](docs/en-US/install-mcp-server.md).

## Basic usage

1. Open the target Design file and **Local Figma Agent Bridge** in Figma Desktop.
2. Check `figma_status` first in the agent.
3. Select the relevant nodes in Figma and describe the read, edit, or generation task.
4. Review the resulting Proposal on the canvas. Public write tools never overwrite the source artwork.

Example requests:

- “Read the current selection and explain its hierarchy, Auto Layout, fonts, and visual styles without changing Figma.”
- “Duplicate the selected card as a Proposal, adjust its spacing and title, then render the result for review.”
- “Use DesignPlan to create a new login-card Proposal. Validate the complete plan first, then apply it and render a preview.”

## How it works

```text
Coding Agent
  ↕ independent stdio session
MCP Adapter
  ↕ authenticated ws://127.0.0.1:3900/mcp
Local Bridge Daemon
  ↕ per-device authenticated ws://127.0.0.1:3900/
Figma plugin UI and main process
  ↕ Figma Plugin API
Current page of the current Design file
```

During first-time pairing, the user compares a six-digit code. Later connections authenticate each plugin device with an independent credential and fresh proofs. The Bridge listens only on `127.0.0.1`; it has no remote or cloud transport.

When editing an existing design, the Bridge clones the targets and required layout context into a Page-level Proposal. Consecutive writes use complete-tree fingerprints to protect concurrent edits. To generate a complex design from scratch, an agent can validate a DesignPlan and then use the single-use, five-minute validation ID to create the Proposal atomically.

See the [architecture and safety model](docs/en-US/architecture.md) for implementation details.

## Security boundaries

- Public write tools can only create a Proposal or edit nodes inside a Bridge-marked Proposal root.
- Input assets accept Base64 only. The Server does not fetch URLs or read caller-provided local files.
- Team Library is never queried. Place an external Instance on the current page before reusing it.
- Exports go only to a temporary directory, include a SHA-256 digest, and are cleaned up after the session.
- Only one Figma plugin window can be active at a time. Remote-only agents cannot reach the local Bridge.

See [security notes](docs/en-US/security.md) for complete boundaries and operational guidance.

## Documentation

| Document                                                     | Audience                   | Contents                                                 |
| ------------------------------------------------------------ | -------------------------- | -------------------------------------------------------- |
| [Documentation home](docs/en-US/README.md)                   | Everyone                   | Choose documentation by task                             |
| [Choose an installation method](docs/en-US/configuration.md) | Users                      | Compare the Agent Plugin and direct MCP routes           |
| [Install the Agent Plugin](docs/en-US/install-plugin.md)     | Plugin client users        | Stable Codex, Cursor, and Copilot installation           |
| [Configure MCP directly](docs/en-US/install-mcp-server.md)   | stdio host users           | Claude, generic hosts, Development, and source builds    |
| [MCP tool reference](docs/en-US/tools.md)                    | Users and agent developers | 23 tools, write boundaries, and call sequences           |
| [Architecture and safety model](docs/en-US/architecture.md)  | Developers                 | Processes, protocol, Proposal, and DesignPlan lifecycles |
| [Development guide](docs/en-US/development.md)               | Contributors               | Monorepo, commands, tests, and builds                    |
| [End-to-end acceptance](docs/en-US/acceptance.md)            | Contributors               | Distribution and Figma scenario validation               |

## Local development

Contributors need Node.js 20+ and pnpm 11.19.0:

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm build:release
```

`pnpm check` validates the Agent Plugin, type-checks, lints, checks formatting, runs tests, and builds. `pnpm build:release` creates the Figma plugin ZIP, npm tarball, portable Agent Plugin ZIP, and `SHA256SUMS` under `artifacts/`.

See the [development guide](docs/en-US/development.md) for the environment and repository structure.

## Current scope

The current stable release supports Windows, local stdio, multiple MCP Adapters, one active Figma plugin, and the current page of the current Design file. It supports reads, renders, exports, controlled Proposal edits, and validated DesignPlans.

The current release does not provide a Windows installer, automatic updates, remote transport, cloud sync, arbitrary JavaScript, direct source-artwork writes, general deletion, Instance detaching, Team Library queries, or framework code generation.

## License

This project is available under the [MIT License](LICENSE). Review generated Proposals and exported content in your own environment before use.
