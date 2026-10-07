# Development guide

[中文版](../zh-CN/development.md) · [Documentation home](README.md)

This pnpm Monorepo contains the local MCP Server, Figma development plugin, shared protocol, test-support package, and portable Agent Plugin. This page is for contributors who want to read, change, or validate the source.

## Requirements

- Windows
- Node.js 20 or newer
- pnpm 11.19.0
- Git
- Figma Desktop, only for plugin integration and end-to-end acceptance

Install dependencies:

```powershell
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
```

## Repository structure

```text
figma_bridge_agent/
├── .agents/marketplaces/     # Canonical Codex, Cursor, and Copilot marketplace indexes
├── .agents/plugins/          # Generated Codex marketplace entry point
├── .cursor-plugin/           # Generated Cursor marketplace entry point
├── .github/plugin/           # Generated Copilot marketplace entry point
├── apps/
│   ├── figma-plugin/          # Figma UI, main process, reads, and Proposal execution
│   └── mcp-server/            # CLI, stdio Adapter, Daemon, and security boundary
├── packages/
│   ├── protocol/              # Shared Zod protocols and types
│   └── test-support/          # Cross-package test helpers
├── plugins/
│   └── figma-local-agent/     # Portable Agent Plugin, MCP config, and workflow Skill
├── docs/                      # Public Chinese and English user/developer documentation
└── scripts/                   # Distribution generation and Agent Plugin validation
```

## Common commands

```powershell
# Type-check, lint, check formatting, test, and build
pnpm check

# Run all tests only
pnpm test

# Build every workspace package
pnpm build

# Rebuild the Figma plugin continuously
pnpm --filter @figma-agent/figma-plugin dev

# Run the complete checks and create local distribution packages
pnpm build:release

# Regenerate committed platform marketplace entry points
pnpm sync:agent-marketplaces

# Verify marketplace schemas, metadata, and generated entry points
pnpm check:agent-marketplaces
```

Edit only the platform sources under `.agents/marketplaces/`, then run `pnpm sync:agent-marketplaces`. Do not edit the generated files under `.agents/plugins/`, `.cursor-plugin/`, or `.github/plugin/` directly. The marketplace check keeps their plugin name, version, source path, author, description, and repository metadata aligned with the portable `plugin.json`.

`pnpm build:release` creates:

```text
artifacts/
├── figma-agent-bridge-plugin-v<VERSION>.zip
├── figma-local-agent-mcp-<VERSION>.tgz
├── figma-local-agent-plugin-v<VERSION>.zip
└── SHA256SUMS
```

`artifacts/` and each package's `dist/` directory are generated and must not be committed.

## Local integration

Run `pnpm build:release` first. You can import `apps/figma-plugin/dist/manifest.json` directly in Figma Desktop, then pair the local CLI from the repository root:

```powershell
node .\apps\mcp-server\dist\cli.js pair
```

Configure the MCP client with the absolute path to `apps/mcp-server/dist/cli.js` from the same build and pass `serve`. See [installation and configuration](configuration.md) for complete examples. Never mix a local plugin with an MCP Server from another commit or version.

## Changing cross-process contracts

The Server and Figma plugin share RPC, authentication, and tool data structures through Zod schemas in `packages/protocol`. When a public capability changes, update and verify all of the following:

1. Protocol schemas, exported types, and protocol tests.
2. MCP Server tool declarations, input mappings, and tool-contract tests.
3. Figma plugin handlers, main/UI messages, and relevant unit tests.
4. The Agent Plugin Skill, DesignPlan reference, and public documentation in both languages.

See the [architecture and safety model](architecture.md) for the security boundary, Proposal marker, and DesignPlan lifecycle. Do not bypass those boundaries with arbitrary scripts, source-artwork writes, or cross-Proposal mutations.

## Test layers

- Protocol tests cover schemas, versions, and boundary values.
- MCP tool-contract tests lock down public tool names, annotations, and recursive input structures.
- Plugin unit tests cover reads, clone scope, fingerprints, rollback, resources, and DesignPlan behavior.
- Script tests cover distribution archives, portable Agent Plugin contents, and marketplace adapter generation and drift detection.
- [End-to-end acceptance](acceptance.md) validates the normal user path with real ZIP and tgz packages in Figma Desktop.

Run at least `pnpm check` before submitting changes. Changes to marketplace sources require `pnpm sync:agent-marketplaces` first. Changes to distribution formats, plugin manifests, the Agent Plugin, or version fields also require `pnpm build:release` and inspection of the generated archives.
