---
name: figma-local-agent
description: Inspect the current local Figma Design for implementation evidence and create reviewable Proposal changes through the Local Figma Agent Bridge.
---

# Local Figma Agent Bridge

Use the bundled `figma-local-agent` MCP server only for the user's currently open Figma Design
document. The bridge is local-first and requires the matching Figma Desktop development plugin to
remain open.

## Connect first

1. Call `figma_status` before any other Figma tool. Record `workspace.state` and
   `workspace.sessionId`; when bound, also record `workspace.rootPath`.
2. On `PLUGIN_NOT_CONNECTED`, ask the user to open **Local Figma Agent Bridge** in Figma Desktop and
   keep its window open.
3. For first-time pairing, ask the user to open the repository's latest GitHub Release, replace
   `<VERSION>` with its version number without the `v` prefix, and run
   `npx -y figma-local-agent-mcp@<VERSION> pair`. Confirm only when the six-digit CLI and plugin
   codes match.
4. If plugin and server versions differ, require both artifacts from the same release before
   retrying.

## Choose the workflow

- **Inspect or navigate:** start with the current selection and a depth 2-4 `figma_get_tree`, then
  read only material nodes with `figma_get_node`. A tree is navigation evidence, not a complete
  implementation snapshot.
- **Implement front-end code:** read
  [front-end implementation](references/frontend-implementation.md). It defines fidelity choice,
  interaction confirmation, evidence escalation, and completion gates. Use
  [semantic snapshots](references/semantic-snapshots.md) for durable, bounded implementation facts.
- **Create project assets:** read [asset export](references/asset-export.md) before planning or
  writing any asset file.
- **Create or modify Figma content:** use isolated Proposals. Read
  [DesignPlan v1](references/design-plan-v1.md) only when constructing a declarative DesignPlan;
  prefer duplication plus targeted mutations for edits to existing artwork.

## Shared read boundaries

- Never print a complete tree artifact or `facts.jsonl` into the conversation. Query temporary
  JSONL or semantic snapshots locally by exact node ID, name, type, or parent ID.
- Treat `truncation` and `artifact` independently. Narrow or split incomplete scopes instead of
  assuming omitted facts.
- Use normalized node or semantic snapshots as implementation evidence. Call `figma_get_css` only
  for a material Inspect-style decision. Use `figma_get_raw_node` only for a known missing fact,
  normally with `depth: 0` and explicit `fields`; it is not a general implementation source.
- Render only when visual evidence changes a decision or a workflow requires visual validation.
  Temporary tree and render files expire after 30 minutes.
- `assetHints` discover candidates only. Re-read a candidate with `figma_get_node` before making an
  asset decision.
- Use `figma_get_fingerprint` for DesignPlan source and Proposal concurrency checks. A bounded node
  snapshot fingerprint has a different scope and is not a substitute.
- The bridge reads the current page only and does not query Team Library. Required library content
  must first be placed on the current page by the user.

## Bind persistent writes

Before the first semantic snapshot or asset write in an implementation phase:

1. Obtain the exact absolute current working directory from the Agent's local execution environment.
2. Call `figma_bind_export_root` with that path and the latest `workspace.sessionId`.
3. Pass workspace-relative destinations only. Never derive the root from plugin state, cache paths,
   Git metadata, or user prose.

Binding is immutable for the Adapter session. If local execution or binding is unavailable, do not
attempt a persistent write. On `EXPORT_TARGET_CONFLICT`, inspect the existing project file; never
select `OVERWRITE` without its checked SHA-256 as `expectedExistingSha256`.

## Proposal write boundaries

- Never modify source artwork directly. Public writes create a Proposal or target a node inside an
  existing bridge-created Proposal.
- For edits, including non-Frame Page children, call `figma_duplicate_as_proposal` and continue only
  with its `proposalRootId` and requested `targetMap`. Never reuse source IDs for Proposal writes.
- Pass each mutation's returned `proposalFingerprint` as the next `expectedFingerprint`, and adopt
  `newProposalRootId` when root component conversion returns it.
- Change Instances through exposed properties; do not reparent or structurally edit internals.
- Re-read or render the affected scope after writing. Before discard, fetch the latest complete-tree
  fingerprint; on `PROPOSAL_CHANGED`, stop and ask whether to inspect the newer state.

## Failure boundaries

- Correct schema or input errors without refreshing unrelated state. For stale or missing nodes,
  refresh only the current page context, mappings, and relevant fingerprints.
- On plugin disconnect, preserve intent, ask the user to reopen the plugin, call `figma_status`, and
  retry only safe read discovery before continuing.
- Stop after an internal apply failure instead of retrying a consumed DesignPlan validation.
- Never expose, request, or print bridge credentials. Pairing and device management remain in the
  local `figma-local-agent-mcp` CLI.
