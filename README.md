# Local Figma Agent MCP

Local-first MCP server and Figma Development Plugin for reading a Figma Design document and making reviewable changes in isolated Proposal copies.

The bridge deliberately does not mutate source artwork. Every public write either creates a Proposal or requires a Proposal root ID. Declarative layout changes use a five-minute, single-use validation ID and re-check the source fingerprint immediately before cloning.

## Requirements

- Node.js 20 or newer
- pnpm 11
- Figma Desktop with permission to edit the current Design file
- A local MCP host such as Codex

## Build and pair

```powershell
pnpm install
pnpm check
node apps/mcp-server/dist/cli.js setup
```

Copy the printed pairing secret. Create a local Development Plugin entry in Figma once, copy the generated manifest `id` into the gitignored repository-root file `.figma-plugin-id` (the file contains only the ID), then build:

```powershell
pnpm --filter @figma-agent/figma-plugin build
```

In Figma Desktop, choose **Plugins → Development → Import plugin from manifest**, then select `apps/figma-plugin/dist/manifest.json`. Start **Local Figma Agent Bridge**, paste the secret, and keep its status window open.

When `.figma-plugin-id` is absent, CI builds use the non-installable placeholder `000000000000000000`; this keeps automated builds deterministic but is not a substitute for the local Figma-generated ID.

The generated secret is stored in the operating-system user configuration directory. The plugin stores the pasted copy in Figma `clientStorage`. Neither value belongs in this repository.

## Run

An MCP host should start the server over stdio:

```powershell
node E:/absolute/path/figma_bridge_agent/apps/mcp-server/dist/cli.js serve
```

Use `doctor` to check the configuration and fixed WebSocket port:

```powershell
node apps/mcp-server/dist/cli.js doctor
```

See [host configuration](docs/hosts.md), [architecture and safety](docs/architecture.md), and the [acceptance runbook](docs/acceptance.md).

## Tool surface

The server exposes exactly 19 closed-world tools:

- Status/read: `figma_status`, `figma_get_selection`, `figma_get_node`, `figma_get_tree`, `figma_get_css`, `figma_get_variables`, `figma_get_raw_node`
- Media: `figma_render_node`, `figma_export_asset`
- Proposal writes: `figma_duplicate_as_proposal`, `figma_create_frame`, `figma_reparent_nodes`, `figma_set_layout`, `figma_update_text`, `figma_set_instance_properties`, `figma_create_component_from_node`, `figma_discard_proposal`
- Declarative layout: `figma_validate_layout_plan`, `figma_apply_layout_plan`

All normal results include structured content and a compact JSON text fallback. PNG renders also include MCP image content and a temporary local path.

## Development

```powershell
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
```

`pnpm check` runs the complete gate. The repository uses small responsibility-focused packages and handlers; entry points only assemble dependencies.

## Scope

Version 0.1 supports one local MCP host, one active Figma plugin, and the current page of the current Design file. It does not expose arbitrary JavaScript, source-node writes, general deletion, instance detach, remote transport, OAuth, cloud sync, GRID/WRAP layout writes, or framework-specific code generation.
