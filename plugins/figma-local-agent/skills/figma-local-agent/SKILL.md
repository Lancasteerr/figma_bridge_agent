---
name: figma-local-agent
description: Inspect the current local Figma page, implement front-end UI from it, or create and edit Figma content through the local bridge. Use when work needs live Figma evidence or Proposal-safe Figma writes; do not use for tasks based only on screenshots or supplied files.
---

# Figma Local Agent Bridge

Use the local MCP bridge as the source of Figma facts. It reads the current page and writes only
through the bridge's Proposal boundaries.

## Start every Figma task

1. Call `figma_status` first. If unavailable, preserve intent and ask the user to reconnect. Pair
   locally with `npx -y figma-local-agent-mcp@<VERSION> pair` when required.
2. Call `figma_activate_workflow` once with the schema-validated enum that matches the current
   phase:
   - `INSPECT`: view, navigate, explain, or compare the design.
   - `FRONTEND`: implement UI or create project assets from the design.
   - `DESIGN`: create or modify Figma content.
3. Continue only after the tool list refreshes. The activation result repeats the exact enabled
   tool names.

Activation changes only this MCP connection's visible tools. It does not connect Figma, bind a
workspace, modify files, or change a Proposal. Reconnecting returns to the two cold-start tools.
For a mixed task, finish the current phase and activate the next workflow; there is no combined
mode.

## Read only the reference needed now

- For front-end reproduction, fidelity decisions, geometry meanings, and completion criteria, read
  [front-end implementation](references/frontend-implementation.md).
- Read [semantic snapshots](references/semantic-snapshots.md) only for a large page/region or when
  durable, queryable evidence is useful.
- Read [asset export](references/asset-export.md) only when preparing to write Figma-derived files
  into the project.
- In the `DESIGN` workflow, read [DesignPlan v1](references/design-plan-v1.md) before using the
  declarative validate/apply path. Targeted Proposal edits do not require that full reference.

## Shared read boundaries

- Use `figma_get_tree` for bounded navigation and `figma_get_node` for implementation facts.
  Request only relevant field groups. `assetHints` identify candidates, not export facts.
- Use `figma_get_css` only when Inspect CSS resolves a material styling choice.
  `figma_get_raw_node` is a bounded fallback for one known missing fact, normally self-only with
  explicit fields.
- Render only when visual evidence changes a decision or validation requires it. Tree and render
  artifacts expire after 30 minutes.
- Never paste a complete tree artifact or semantic JSONL into the conversation. Query by exact ID,
  name, type, or parent and narrow any truncated scope.
- The bridge reads the current page only and never queries Team Library. Ask the user to place
  required library content on the current page.

## Bind persistent workspace writes

Before the first semantic snapshot or project asset write:

1. Obtain the exact absolute current working directory from the Agent execution environment.
2. Call `figma_bind_export_root` with it and the latest `workspace.sessionId` from
   `figma_status`.
3. Use only workspace-relative destinations.

The binding is immutable for the Adapter session and is shared by semantic and asset writes. Never
infer the root from plugin state, Git metadata, caches, or user prose. If binding is unavailable, do
not write. On `EXPORT_TARGET_CONFLICT`, inspect the existing file; use `OVERWRITE` only with its
checked SHA-256 as `expectedExistingSha256`.

## Proposal write boundaries

- Never edit source artwork directly. Duplicate it with `figma_duplicate_as_proposal`, then use
  only the returned `proposalRootId` and requested `targetMap`.
- Chain each mutation's `proposalFingerprint` into the next `expectedFingerprint`; adopt
  `newProposalRootId` after root component conversion.
- Change Instances only through exposed properties. Re-read or render affected content after
  writes.
- Before discard, fetch the latest complete-tree fingerprint. On `PROPOSAL_CHANGED`, stop and ask
  whether to inspect the newer state.

Correct input errors without refreshing unrelated state. For stale nodes, refresh only the current
page context and relevant mappings or fingerprints. Do not retry a consumed DesignPlan validation
after an internal apply failure, and never expose bridge credentials.
