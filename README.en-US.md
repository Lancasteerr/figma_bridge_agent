# Local Figma Agent MCP

Let a local coding agent safely read Figma Design documents and create reviewable changes in isolated Proposal copies.

[中文文档](README.md) · [Quick start](#quick-start) · [Latest release](https://github.com/Lancasteerr/figma_bridge_agent/releases/latest) · [Report an issue](https://github.com/Lancasteerr/figma_bridge_agent/issues) · [Full configuration](docs/en-US/configuration.md)

> Local first · Source artwork is never directly mutated · No cloud relay · No telemetry

This is an unofficial development tool distributed through GitHub. It is not affiliated with or endorsed by Figma, and it is not published through Figma Community. Figma files and bridge credentials stay on the local loopback connection.

## Contents

- [Introduction](#introduction)
- [Core features](#core-features)
- [Interface preview](#interface-preview)
- [How it works](#how-it-works)
- [Quick start](#quick-start)
- [Configure an MCP client](#configure-an-mcp-client)
- [Basic usage](#basic-usage)
- [MCP tool reference](#mcp-tool-reference)
- [Security boundaries and limitations](#security-boundaries-and-limitations)
- [Updates, recovery, and troubleshooting](#updates-recovery-and-troubleshooting)
- [Project structure and development](#project-structure-and-development)
- [Version scope](#version-scope)
- [Disclaimer and License](#disclaimer-and-license)

## Introduction

Local Figma Agent MCP connects a coding agent on your computer to the currently open Figma Design file. The agent can read nodes, structure, styles, fonts, and renders, and it can create or edit isolated Proposals. Public tools never directly rewrite source artwork.

The project has three cooperating parts:

| Component                    | Responsibility                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Agent Plugin**             | Installs the agent workflow instructions and configures the stdio MCP Server automatically                    |
| **MCP Server**               | Exposes 23 bounded tools and manages the local Daemon, authentication, validation, and temporary assets       |
| **Figma development plugin** | Reads the current document inside Figma Desktop and executes Proposal operations through the Figma Plugin API |

The project is intended for local design inspection, design review, controlled edits, and declarative UI generation. It requires Windows, Figma Desktop, and a client that supports local stdio MCP. ChatGPT Web, Codex Cloud, and other remote-only environments cannot reach the local Bridge.

## Core features

| Feature                        | Description                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| 🔒 Local data path             | Figma data, pairing credentials, and RPC traffic remain on the computer with no cloud relay                         |
| 🧪 Proposal isolation          | Existing designs are copied into Page-level Proposals before editing; public write tools cannot mutate source nodes |
| 👁️ Structural and visual reads | Read nodes, trees, variables, fonts, CSS hints, PNG renders, and PNG/SVG exports                                    |
| 🛠️ Controlled editing          | Edit layout, text, hierarchy, components, and Instance properties inside a Proposal boundary                        |
| 📐 DesignPlan                  | Validate a complete declarative plan before atomically creating a Proposal with a single-use validation ID          |
| 🔁 Multi-client reuse          | Multiple local MCP Adapters can share one automatically managed Bridge Daemon                                       |

## Interface preview

Screenshot files live under [`docs/img`](docs/img/README.md). The positions below reserve separate layouts for the plugin window and the Figma canvas. Uncomment the corresponding HTML after adding each image; until then, the README shows no broken image links.

### First-time pairing

The unpaired state shows the PowerShell command. After pairing begins, the terminal and plugin each display a six-digit code that the user must compare.

<p align="center">
  <img src="docs/img/plugin-unpaired.png" width="360" alt="Local Figma Agent Bridge unpaired state" />
  <img src="docs/img/plugin-pairing.png" width="360" alt="Local Figma Agent Bridge six-digit code confirmation" />
</p>

### Connected state

After pairing, the plugin window shows the Bridge connection state, current document, and last connection time.

<p align="center">
  <img src="docs/img/plugin-connected.png" width="420" alt="Local Figma Agent Bridge connected state" />
</p>

### Proposal review

Agent edits appear in an isolated Proposal so they can be inspected beside the source design on the Figma canvas.

## How it works

### Processes and data path

```text
Coding Agent (Codex / Claude Code / Cursor / others)
  ↕ independent stdio session
MCP Adapter
  ↕ authenticated ws://127.0.0.1:3900/mcp
Local Bridge Daemon
  ↕ per-device authenticated ws://127.0.0.1:3900/
Figma plugin UI
  ↕ validated postMessage
Figma plugin main process
  ↕ Figma Plugin API
Current page of the current Design file
```

The Agent Plugin is only a distribution layer and never receives Figma data. Each MCP client gets an independent stdio Adapter. The first Adapter starts the Daemon on demand, and multiple Adapters reuse the same plugin connection. The Daemon exits 30 seconds after both the last Adapter and the plugin disconnect.

On first use, the CLI and Figma plugin each display a six-digit code. After the user confirms that the codes match, the plugin receives its own device credentials. Later sessions authenticate and reconnect automatically. During normal operation, the Bridge listens only on `127.0.0.1`.

### Editing an existing design

```text
Read source → Clone targets and required layout context → Create isolated Proposal
            → Edit inside Proposal → Read or render again → Review in Figma
```

`figma_duplicate_as_proposal` resolves a bounded layout context automatically and moves the clone to the Page before allowing edits. Later write tools must include the Proposal root ID. Pass the fingerprint returned by each mutation as the next operation's `expectedFingerprint` to avoid overwriting concurrent edits.

### Generating a design from scratch

Complex designs can use a DesignPlan. The agent first reads fonts, resources, and optional source fingerprints, then submits one complete plan for read-only validation. Successful validation returns a single-use ID that expires after five minutes. `figma_apply_design_plan` re-checks sources and resources before atomically creating the Proposal. Validation and write failures do not leave a partial design behind.

See [architecture](docs/en-US/architecture.md) and [security](docs/en-US/security.md) for details.

## Quick start

### Requirements

- Windows
- Node.js 20 or newer
- Figma Desktop
- A coding agent with local stdio MCP or Agent Plugins 1.0 support

Regular users do not need Git, pnpm, or a source checkout. The Figma plugin ZIP and MCP npm package must come from the same version. This guide pins both to `0.9.0`.

### 1. Install the Agent Plugin

Clients with Agent Plugins 1.0 support should use the portable Agent Plugin. For example, in Codex CLI:

```powershell
codex plugin marketplace add Lancasteerr/figma_bridge_agent --ref v0.9.0
codex plugin add figma-local-agent@figma-local-agent
```

After adding the marketplace, ChatGPT Desktop users should restart the app and install **Local Figma Agent** from the Plugins Directory. Other compatible clients can import `plugins/figma-local-agent` from the same tag. The Agent Plugin configures the matching stdio MCP Server automatically.

### 2. Import the Figma plugin

Download `figma-agent-bridge-plugin-v0.9.0.zip` from the matching [v0.9.0 GitHub Release](https://github.com/Lancasteerr/figma_bridge_agent/releases/tag/v0.9.0) and extract it to a folder that will not be moved or deleted.

In **Figma Desktop → Plugins → Development → Import plugin from manifest**, select:

```text
figma-agent-bridge-plugin/manifest.json
```

### 3. Complete first-time pairing

Start **Local Figma Agent Bridge** in Figma and keep its window open. Then run this command in PowerShell:

```powershell
npx -y figma-local-agent-mcp@0.9.0 pair
```

Compare the six-digit codes shown by PowerShell and the plugin. Click **Codes match** only when they are identical. The plugin reconnects automatically after a successful pairing.

### 4. Verify the connection

Restart the MCP client or open a new agent session, then ask the agent to call `figma_status`. A successful result includes the current Figma document, page, selection, and Bridge capabilities.

For Development build and source-build installation, see the [complete installation and configuration guide](docs/en-US/configuration.md). Never mix a Development plugin with a stable MCP package, or vice versa.

## Configure an MCP client

### Recommended: automatic Agent Plugin configuration

After installing the `figma-local-agent` Agent Plugin, no handwritten MCP configuration is needed. Its `mcp.json` starts:

```text
npx.cmd -y figma-local-agent-mcp@0.9.0 serve
```

### Manual configuration fallback

Add a stdio Server manually only when the client does not support Agent Plugins 1.0. Windows GUI applications should use `npx.cmd`, not `npx`.

Project-level `.codex/config.toml` for Codex:

```toml
[mcp_servers.figma_local_agent]
command = "npx.cmd"
args = ["-y", "figma-local-agent-mcp@0.9.0", "serve"]
startup_timeout_sec = 15
tool_timeout_sec = 130
enabled = true
```

Claude Code, Claude Desktop, Cursor, or another standard stdio MCP client:

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

Restart the MCP client after saving the configuration. See [Windows MCP host configuration](docs/en-US/hosts.md) for more client examples.

### Configuration check

```powershell
npx -y figma-local-agent-mcp@0.9.0 doctor
```

After the check, confirm that:

1. A Design file is open in Figma.
2. **Local Figma Agent Bridge** is running and its window remains open.
3. The MCP client can discover `figma_status`.
4. `figma_status` returns the current document, page, and selection.

## Basic usage

1. Open the target Design file and **Local Figma Agent Bridge** in Figma Desktop.
2. Check `figma_status` first in the agent.
3. Select the relevant nodes in Figma and describe the read or edit you want.
4. Edit requests create an isolated Proposal. Review the copy in Figma without replacing the source artwork.

Example requests:

- **Read a design:** “Read the current selection and explain its hierarchy, Auto Layout, fonts, and visual styles without changing Figma.”
- **Edit a design:** “Duplicate the selected card as a Proposal, adjust its spacing and title, then render the result for review.”
- **Generate a design:** “Use a DesignPlan to create a new login-page Proposal. Validate the complete plan first, then apply it and render a preview.”

## MCP tool reference

The server exposes a closed set of exactly 23 MCP tools. “Writes to Figma” indicates whether a tool changes the current Figma document. Reads, exports, and in-memory asset staging do not change the document.

### Status

| Tool           | Purpose                                                                           | Writes to Figma |
| -------------- | --------------------------------------------------------------------------------- | --------------- |
| `figma_status` | Return the plugin connection, current document, page, selection, and capabilities | No              |

### Reads and discovery

| Tool                         | Purpose                                                                                            | Writes to Figma |
| ---------------------------- | -------------------------------------------------------------------------------------------------- | --------------- |
| `figma_get_design_resources` | Page through local styles and variables plus reusable components and Instances on the current page | No              |
| `figma_list_fonts`           | Page through fonts currently available to Figma, including variable-font axes                      | No              |
| `figma_get_raw_node`         | Read bounded `JSON_REST_V1` for unsupported or unnormalized debugging details                      | No              |
| `figma_get_variables`        | Page through local variables and their collections                                                 | No              |
| `figma_get_css`              | Return Figma Inspect CSS as a code-generation hint                                                 | No              |
| `figma_get_selection`        | Return shallow summaries for selected nodes on the current page                                    | No              |
| `figma_get_node`             | Return a normalized snapshot of one node and direct-child summaries                                | No              |
| `figma_get_tree`             | Return a normalized subtree bounded by depth, node count, and text length                          | No              |
| `figma_get_fingerprint`      | Calculate an ordered aggregate fingerprint of complete node subtrees                               | No              |

### Rendering and assets

| Tool                 | Purpose                                                                      | Writes to Figma |
| -------------------- | ---------------------------------------------------------------------------- | --------------- |
| `figma_render_node`  | Render a node as a bounded PNG for visual inspection                         | No              |
| `figma_export_asset` | Export a node to a temporary PNG or SVG path with a SHA-256 digest           | No              |
| `figma_stage_asset`  | Validate and stage Agent-provided Base64 bitmap or SVG data in plugin memory | No, memory only |

### Proposal operations

| Tool                               | Purpose                                                               | Writes to Figma       |
| ---------------------------------- | --------------------------------------------------------------------- | --------------------- |
| `figma_duplicate_as_proposal`      | Clone edit targets and required context into an isolated Proposal     | Yes, new copy only    |
| `figma_create_frame`               | Create an ordinary Frame inside a Proposal                            | Yes, Proposal only    |
| `figma_reparent_nodes`             | Move nodes inside one Proposal with flow or absolute placement        | Yes, Proposal only    |
| `figma_set_layout`                 | Set Auto Layout, spacing, sizing, and positioning on Proposal nodes   | Yes, Proposal only    |
| `figma_create_component_from_node` | Convert a Frame inside a Proposal into a Component                    | Yes, Proposal only    |
| `figma_set_instance_properties`    | Edit exposed Instance properties without detaching the Instance       | Yes, Proposal only    |
| `figma_update_text`                | Atomically update Proposal text after preloading required fonts       | Yes, Proposal only    |
| `figma_discard_proposal`           | Delete an unchanged Bridge-created Proposal using a fingerprint check | Yes, deletes Proposal |

### DesignPlan

| Tool                         | Purpose                                                                         | Writes to Figma        |
| ---------------------------- | ------------------------------------------------------------------------------- | ---------------------- |
| `figma_validate_design_plan` | Read-only validation of a complete DesignPlan with a five-minute, single-use ID | No                     |
| `figma_apply_design_plan`    | Atomically create a complete Proposal with a valid validation ID                | Yes, new Proposal only |

`figma_get_fingerprint` returns an ordered aggregate fingerprint of complete subtrees. Use it for DesignPlan `source.fingerprint`, Proposal optimistic-concurrency checks, and safe discard. Snapshot fingerprints returned by bounded reads such as `figma_get_node` and `figma_get_tree` cover different data and are not substitutes. For consecutive Proposal mutations, pass each write result's new fingerprint as the next operation's `expectedFingerprint`.

## Security boundaries and limitations

- **Immutable source artwork:** Public write tools either create a Proposal or operate inside a Bridge-marked Proposal root.
- **Concurrency protection:** Proposal mutations and discard operations can check complete-tree fingerprints instead of overwriting or deleting user edits blindly.
- **Local authentication:** WebSocket endpoints bind only to `127.0.0.1`. A six-digit code confirms initial pairing; later requests use device credentials and fresh proofs.
- **Asset limits:** Inputs accept Base64 only. The server does not fetch URLs or read caller-provided local paths. Bitmaps are limited to 8 MiB/4096 px and SVG to 2 MiB/16384 units.
- **Temporary files:** Exports go under `%TEMP%/figma-agent-mcp/<session>/`, are deleted when the session closes, and stale sessions older than 24 hours are cleaned up.
- **Bounded logging:** Daemon logs omit credentials, image Base64, and raw node JSON, and keep only one rotated file.
- **Team Library:** The Bridge never queries Team Library. Place a required library Instance on the current page before asking the agent to reuse it.
- **Runtime scope:** The Bridge supports only local environments and one active Figma plugin window. Remote-only agents cannot reach it.

See the [architecture and security model](docs/en-US/architecture.md), [security notes](docs/en-US/security.md), and [acceptance runbook](docs/en-US/acceptance.md) for the complete boundaries.

## Updates, recovery, and troubleshooting

### Updates and device management

- Update the Figma plugin ZIP and MCP npm package together. Never mix versions.
- `npx -y figma-local-agent-mcp@0.9.0 doctor`: inspect the local service without printing credentials.
- `npx -y figma-local-agent-mcp@0.9.0 devices list`: list paired devices.
- `npx -y figma-local-agent-mcp@0.9.0 devices revoke <deviceId>`: revoke one device.
- `npx -y figma-local-agent-mcp@0.9.0 devices revoke --all`: revoke every device; the plugin must pair again.

Upgrading from v0.1 removes the old shared secret and requires one new pairing. Close every v0.1 MCP task first so its old Daemon releases port 3900.

### Common problems

| Symptom                               | Resolution                                                                                                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PLUGIN_NOT_CONNECTED`                | Open **Local Figma Agent Bridge** in Figma Desktop and keep its window open; complete pairing first on a new installation                                      |
| Connection fails after an update      | Confirm that the plugin ZIP and MCP Server versions match exactly, then pair again if necessary and restart the MCP client                                     |
| `npx.cmd` cannot be found             | Install Node.js 20+, restart the client, and run `where.exe npx` in PowerShell to check PATH                                                                   |
| Port 3900 is already in use           | Close old MCP tasks, then run `doctor` to inspect the Daemon state                                                                                             |
| The agent cannot see the tools        | Confirm that the stdio configuration was saved, then restart the client or open a new agent session                                                            |
| A local `.tgz` opens in a desktop app | For a Development build, use `npm.cmd exec --package=file:... -- figma-local-agent-mcp serve`; do not pass the `.tgz` directly as an `npx` positional argument |

See [installation and configuration](docs/en-US/configuration.md) for complete stable, Development build, source-build, and recovery instructions.

## Project structure and development

```text
figma_bridge_agent/
├── apps/
│   ├── figma-plugin/          # Figma UI, main process, reads, and Proposal execution
│   └── mcp-server/            # CLI, stdio MCP Adapter, Daemon, and security boundary
├── packages/
│   ├── protocol/              # Shared Zod protocols and types
│   └── test-support/          # Cross-package test helpers
├── plugins/
│   └── figma-local-agent/     # Portable Agent Plugin, MCP configuration, and workflow Skill
├── docs/
│   ├── zh-CN/                 # Chinese architecture, configuration, security, and acceptance docs
│   └── en-US/                 # Matching English documentation
└── scripts/                   # Release artifact generation and validation
```

Contributors need Node.js 20+ and pnpm 11:

```powershell
pnpm install
pnpm check
pnpm build:release
```

`pnpm check` runs Agent Plugin validation, type checking, linting, formatting checks, tests, and builds. `pnpm build:release` creates the Figma plugin ZIP, npm tarball, portable Agent Plugin ZIP, and `SHA256SUMS` under `artifacts/`.

Further reading:

- [Installation and configuration](docs/en-US/configuration.md)
- [Architecture and security model](docs/en-US/architecture.md)
- [Security notes](docs/en-US/security.md)
- [Acceptance runbook](docs/en-US/acceptance.md)

## Version scope

Version 0.9 supports multiple local MCP Adapters, one active Figma plugin, and the current page of the current Design file. It supports reads, renders, exports, controlled Proposal edits, and validated DesignPlans.

The following are outside the current release: Windows installers, automatic updates, remote transport, cloud sync, arbitrary JavaScript, source-node writes, general deletion, Instance detaching, Team Library queries, and framework-specific code generation.

## Disclaimer and License

Local Figma Agent MCP is an independent, unofficial open-source project. It is not affiliated with, partnered with, or endorsed by Figma. Review generated Proposals and exported content in your own environment before use.

This project is available under the [MIT License](LICENSE).
