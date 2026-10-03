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

- Inspect the current page and selection before requesting broader trees.
- Use bounded node reads for structure and text, rendering only when visual evidence is necessary.
- Use `figma_get_fingerprint` for DesignPlan source fingerprints and Proposal concurrency checks.
  Snapshot fingerprints returned by bounded reads have a different scope and are not substitutes.
- Request fonts and local design resources only when the task needs them. The bridge does not query
  Team Library; the user must first place any required library instance on the current page.

## Write workflow

- Never modify source artwork directly. Public writes must create a Proposal or target a node inside
  an existing bridge-created Proposal.
- For edits based on existing artwork, use `figma_duplicate_as_proposal` and continue with the IDs
  returned for the isolated copy.
- For declarative creation, collect the required source fingerprints, fonts, resources, and staged
  assets, then call `figma_validate_design_plan` exactly once for the final plan. Apply the returned
  validation ID with `figma_apply_design_plan` before it expires; validation IDs are single-use.
- Re-read or render the Proposal after applying changes so the user can review the result.
- Before discarding a Proposal, obtain its latest complete-tree fingerprint with
  `figma_get_fingerprint`. If the bridge returns `PROPOSAL_CHANGED`, stop and ask the user whether to
  inspect the newer state; never retry deletion with a stale fingerprint.

## Failure handling

- Treat source, fingerprint, validation, asset, font, or resource conflicts as a request to refresh
  state and rebuild the pending operation. Do not bypass validation.
- When a tool reports that the plugin disconnected, preserve the user's intent, ask them to reopen
  the Figma plugin, call `figma_status`, and only then retry safe read-only discovery.
- Do not expose, request, or print bridge credentials. Pairing and device management remain in the
  local `figma-local-agent-mcp` CLI.
