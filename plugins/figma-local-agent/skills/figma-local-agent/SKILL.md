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
2. If it returns `PLUGIN_NOT_CONNECTED`, ask the user to open **Local Figma Agent Bridge** in Figma
   Desktop and keep its window open.
3. If this is the first connection, ask the user to run
   `npx -y figma-local-agent-mcp@0.9.0 pair`, compare the six-digit code with the Figma plugin, and
   confirm only when the codes match.
4. If the plugin and server versions differ, ask the user to install both artifacts from the same
   `v0.9.0` release before retrying.

## Read workflow

- Start from the current page and selection reported by `figma_status`. Read a shallow local tree,
  normally depth 2–4, then use only the targeted node reads the task still needs.
- Keep reads bounded and render only when visual evidence is necessary.
- Use `figma_get_fingerprint` for DesignPlan source fingerprints and Proposal concurrency checks.
  Snapshot fingerprints returned by bounded reads have a different scope and are not substitutes.
- Request fonts and local design resources only when the task needs them. The bridge does not query
  Team Library; the user must first place any required library instance on the current page.

## Write workflow

- Never modify source artwork directly. Public writes must create a Proposal or target a node inside
  an existing bridge-created Proposal.
- For edits based on existing artwork, including non-Frame Page children, use
  `figma_duplicate_as_proposal`. Continue only with its `proposalRootId`, `targetMap`, and `idMap`;
  never reuse source IDs for Proposal writes.
- Pass each mutation's returned fingerprint as the next mutation's `expectedFingerprint`, and adopt
  replacement IDs returned by operations such as component conversion.
- Change an Instance through exposed properties. Do not reparent or structurally edit its internals.
- For complex declarative generation, first read [DesignPlan v1](references/design-plan-v1.md). Its
  Frame root is an isolated Proposal container and may represent a local design rather than a page.
- Validate each complete DesignPlan candidate once. If validation fails, correct the reported issue
  and treat the revision as a new candidate; never probe the schema through repeated calls. Apply a
  successful validation ID before it expires because IDs are single-use.
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
