---
name: figma-local-agent
description: Read the current local Figma Design document and create reviewable changes inside isolated Proposals through the Local Figma Agent Bridge.
---

# Local Figma Agent Bridge

Use the bundled `figma-local-agent` MCP server for requests involving the user's currently open
Figma Design document. The bridge is local-first and works only while the matching Figma Desktop
development plugin is open.

## Connection preflight

1. Call `figma_status` before other Figma tools.
   Record `workspace.state` and `workspace.sessionId`; when bound, also record `workspace.rootPath`.
2. If it returns `PLUGIN_NOT_CONNECTED`, ask the user to open **Local Figma Agent Bridge** in Figma
   Desktop and keep its window open.
3. If this is the first connection, ask the user to open the repository's latest GitHub Release,
   replace `<VERSION>` with its version number without the `v` prefix, and run
   `npx -y figma-local-agent-mcp@<VERSION> pair`. Compare the six-digit code with the Figma plugin,
   and confirm only when the codes match.
4. If the plugin and server versions differ, ask the user to install both artifacts from the same
   `v<VERSION>` release before retrying.

## Read workflow

- Start from the current page and selection reported by `figma_status`. Read a shallow local tree,
  normally depth 2–4, then use only the targeted node reads the task still needs. `figma_get_tree`
  is a lightweight navigation result, not a complete implementation snapshot.
- Treat `truncation` and `artifact` independently. `truncation` means Figma traversal hit a depth or
  node limit; `artifact` means the lightweight tree was delivered in a temporary JSONL file instead
  of entirely inline. Either field may appear without the other.
- Never print an entire tree JSONL into the conversation. Filter a few records locally by exact
  node ID, name, type, or parent ID, or issue a narrower `figma_get_tree` call rooted at the chosen
  node. Temporary tree files expire after 30 minutes; repeat the read after expiry.
- For implementation work that needs durable design evidence, read
  [semantic snapshots](references/semantic-snapshots.md). The bridge exports objective Figma facts;
  the Agent decides scope boundaries, code mappings, and unresolved differences.
- Keep reads bounded and render only when visual evidence is necessary. `figma_render_node` returns
  a temporary local PNG path rather than image bytes. Open that path with the Agent's visual tool
  only when a visual decision is required; re-render if `expiresAt` has passed.
- `figma_get_tree.assetHints` only discovers possible image, export, vector, and mask candidates.
  Re-read a candidate with `figma_get_node`; its `assets` field provides exact Image Paint hashes,
  dimensions, transforms, export settings, vector counts, and mask facts needed for decisions.
- Use `figma_get_fingerprint` for DesignPlan source fingerprints and Proposal concurrency checks.
  Snapshot fingerprints returned by bounded reads have a different scope and are not substitutes.
- Request fonts and local design resources only when the task needs them. The bridge does not query
  Team Library; the user must first place any required library instance on the current page.

## Front-end implementation

Read [front-end implementation](references/frontend-implementation.md) before implementing a web
page, application screen, or reusable UI component from the current Figma document.

- If the user has not specified the fidelity policy, ask them to choose high-fidelity reproduction
  or engineering adaptation before committing to an implementation plan. Do not ask again when the
  request already makes the priority clear. If interaction is unavailable or the user asks you to
  continue without answering, default to high fidelity and state that assumption.
- In high-fidelity mode, do not replace a visually distinctive Figma icon or vector with a library
  icon unless their outline, fill, stroke, bounds, and optical alignment have been verified as
  equivalent. Do not add effects or typographic adjustments that are absent from the design.
- Target visually important, ambiguous, or replacement-candidate leaf nodes instead of reading
  every descendant. Escalate from normalized snapshots to `figma_get_css`, then bounded
  `figma_get_raw_node`, only when the missing fact changes the implementation decision.
- A fresh Figma render and an implementation screenshot are a completion gate for high-fidelity
  work. Known material differences in geometry, color, effects, icon shape, typography, or image
  crop must be corrected or reported as unresolved; do not describe such work as visually passed.
- Engineering adaptation may favor existing components and icon libraries, but disclose planned
  and delivered visible deviations from Figma.
- A single-node or single-component request stays scoped to that target. Do not expand it into a
  page workflow. For a large region or page, export `OUTLINE` first and activate only one bounded
  `IMPLEMENTATION` scope at a time.

## Asset planning and delivery

Read [asset export](references/asset-export.md) before a task that may create front-end asset files.

- During planning, use a lightweight tree to discover candidates, inspect exact facts with targeted
  node reads, render only useful previews, and inspect the front-end project for existing
  components, icons, and images. Do not call `figma_export_asset` in this phase and do not create
  project files merely to evaluate an option.
- Prefer code for text, layout, interaction, and simple shapes. Prefer `RAW` for Image Paint source
  bytes when CSS can reproduce crop, radius, layout, and ordinary filters. Consider `RENDERED` for
  a standalone logo, complex vector, mask, or special compositing whose appearance must be baked.
- Record every planned export's node ID, paint slot/index when applicable, mode, format, relative
  destination, and source fingerprint. Export only that recorded set during implementation.
- Immediately before export, re-read the node. Use its current snapshot fingerprint and image hash
  for `RAW`; call `figma_get_fingerprint` for the node's current complete-tree fingerprint before
  `RENDERED`.
- Before the first implementation-phase asset or semantic write, obtain the exact current working
  directory from the Agent's own local task execution environment and call
  `figma_bind_export_root` with that absolute path and the latest `workspace.sessionId`. Never
  derive the root from the plugin process, plugin cache, Git metadata, or user-provided prose.
  Binding is session-local and must happen before either write class starts. If local execution or
  binding is unavailable, do not attempt a persistent write; it will return `EXPORT_ROOT_UNBOUND`.
- Pass workspace-relative paths only. `figma_export_asset` returns the workspace-relative `path`
  and `CREATED`, `REUSED`, or `UPDATED` status; resolve the path below the bound root when editing
  project files.
- On `EXPORT_TARGET_CONFLICT`, inspect the existing project file. Never switch to `OVERWRITE`
  automatically; use it only after intentionally checking the existing SHA-256 and pass that value
  as `expectedExistingSha256`.
- Before completion, compare the implemented page with a fresh Figma render and verify all asset
  references resolve from the project.

## Write workflow

- Never modify source artwork directly. Public writes must create a Proposal or target a node inside
  an existing bridge-created Proposal.
- For edits based on existing artwork, including non-Frame Page children, use
  `figma_duplicate_as_proposal`. Continue only with its `proposalRootId` and requested `targetMap`;
  never reuse source IDs for Proposal writes or assume unrequested clone mappings exist.
- Pass each mutation's returned `proposalFingerprint` as the next mutation's
  `expectedFingerprint`, and adopt `newProposalRootId` when root component conversion returns it.
- Change an Instance through exposed properties. Do not reparent or structurally edit its internals.
- For complex declarative generation, first read [DesignPlan v1](references/design-plan-v1.md). Its
  Frame root is an isolated Proposal container and may represent a local design rather than a page.
- Validate each complete DesignPlan candidate once. If validation fails, correct the reported issue
  and treat the revision as a new candidate; never probe the schema through repeated calls. Apply a
  successful validation ID before it expires because IDs are single-use. Put up to 200 unique refs
  needed after apply in validation-request `returnRefs`; do not add them to the DesignPlan body.
  Apply omits `refMap` when no refs were requested.
- Re-read or render the affected scope after writing; add an overall preview for layout-wide changes.
- Before discarding a Proposal, obtain its latest complete-tree fingerprint with
  `figma_get_fingerprint`. If the bridge returns `PROPOSAL_CHANGED`, stop and ask the user whether to
  inspect the newer state; never retry deletion with a stale fingerprint.

## Failure handling

- Correct input or schema errors without refreshing unrelated state. For stale or missing nodes,
  refresh the current page, mappings, and relevant fingerprint before rebuilding the operation.
- For protected Instance errors, use exposed properties or rebuild ordinary structure. On an apply
  internal error, stop instead of blindly retrying the single-use operation and report the failure.
- When a tool reports that the plugin disconnected, preserve the user's intent, ask them to reopen
  the Figma plugin, call `figma_status`, and only then retry safe read-only discovery.
- Do not expose, request, or print bridge credentials. Pairing and device management remain in the
  local `figma-local-agent-mcp` CLI.
