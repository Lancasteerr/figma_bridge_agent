---
name: figma-local-agent
description: Inspect the current local Figma page, implement front-end UI from it, or create and edit Figma content through the local bridge. Use when work needs live Figma evidence or Proposal-safe Figma writes; do not use for tasks based only on screenshots or supplied files.
---

# Figma Local Agent Bridge

Use the local MCP bridge as the source of Figma facts. Tools are always registered and their names
identify the domain: `figma_inspect_*`, `figma_frontend_*`, and `figma_design_*`.

## Start every Figma task

1. Call `figma_status`. If unavailable, preserve intent and ask the user to reconnect. Pair locally
   with `npx -y figma-local-agent-mcp@<VERSION> pair` when required.
2. For front-end work, bind the exact absolute project root with
   `figma_frontend_bind_workspace` and the latest `workspace.sessionId` before preparing a workunit
   or exporting project assets.
3. Use only the domain tools needed for the task. There is no workflow activation step.

## Read only the reference needed now

- For front-end fidelity, interaction boundaries, and completion rules, read
  [front-end implementation](references/frontend-implementation.md). Read
  [workunits](references/workunits.md) before preparing or maintaining implementation evidence.
  Prepare every implementation scope with `figma_frontend_prepare_workunit`; its workunit is the
  implementation context.
- Read [asset export](references/asset-export.md) only when a material element may become a project
  file.
- Read [DesignPlan v1](references/design-plan-v1.md) before the declarative validate/apply path.
  Targeted Proposal edits do not require that full reference.

## Static front-end evidence boundary

For front-end implementation, Inspect results, workunit facts, and previews are static visual
evidence. They can establish materialized layout, styling, text, assets, clipping, and visible
states, but not runtime interaction, responsive behavior, data effects, state transitions, or
scrolling behavior. Read [front-end implementation](references/frontend-implementation.md) and
confirm material behavior that remains unresolved after inspecting the request and repository.

## Shared read boundaries

- Use `figma_inspect_browse_nodes` for bounded navigation and
  `figma_inspect_read_node_facts` for targeted facts. Request only relevant field groups.
  `assetHints` identify candidates, not export facts.
- Use `figma_inspect_read_css_hint` only when Inspect CSS resolves a material styling choice.
  `figma_inspect_read_raw_fields` is a bounded fallback for one known missing fact.
- Use `figma_inspect_render_preview` only when visual evidence changes a decision or for the final
  appearance check. Do not build pixel-diff infrastructure.
- Never paste a complete tree artifact or `facts.jsonl` into conversation. Query local JSONL by
  exact node ID or name and narrow a truncated scope.
- The bridge reads the current page only and never queries Team Library. Ask the user to place
  required library content on the current page.

## Persistent workspace writes

The workspace binding is immutable for one Adapter session. Never infer it from plugin state, Git
metadata, caches, or user prose. Use workspace-relative destinations only. On
`EXPORT_TARGET_CONFLICT`, inspect the existing file and use `OVERWRITE` only with its checked
SHA-256 as `expectedExistingSha256`.

## Proposal write boundaries

- Never edit source artwork directly. For changes to existing artwork, duplicate it with
  `figma_design_duplicate_as_proposal`, then use only the returned `proposalRootId` and requested
  `targetMap`. A DesignPlan may instead create a new isolated Proposal.
- Chain each mutation's `proposalFingerprint` into the next `expectedFingerprint`; adopt
  `newProposalRootId` after root component conversion.
- Change Instances only through exposed properties. Re-read or render affected content after
  writes.
- Before discard, fetch the latest complete-tree fingerprint with
  `figma_design_read_source_fingerprint`.

Correct input errors without refreshing unrelated state. Do not retry a consumed DesignPlan
validation after an internal apply failure, and never expose bridge credentials.
