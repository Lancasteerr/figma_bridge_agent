# End-to-end acceptance runbook

[中文版](acceptance.zh-CN.md)

Run `pnpm build:release` before manual acceptance. Perform the user path from the generated ZIP and npm tarball, not from workspace entry points. Use a disposable Figma page for mutation scenarios.

## 1. Distribution and pairing gate

1. On a clean Windows account with Node.js 20+, extract `artifacts/figma-agent-bridge-plugin-v0.2.0.zip` and import its `manifest.json` in Figma Desktop without editing the ID.
2. Start the plugin and confirm there is no secret or Plugin ID input.
3. Run `npx -y ./artifacts/figma-local-agent-mcp-0.2.0.tgz pair`.
4. Confirm both surfaces show the same six-digit code, click **Codes match**, and verify the CLI reports success.
5. Restart Figma and the MCP host; confirm the plugin reconnects without another pairing.
6. Run `devices list`, revoke the connected device, and confirm the plugin immediately returns to the pairing screen.

Do not continue acceptance if this gate fails.

## 2. Connection and read path

1. Start Codex with the configuration in `docs/hosts.md`.
2. Call `figma_status`; confirm authenticated protocol v3, file/page metadata, selection summary, and the `adaptive-proposal-scope-v2` capability.
3. Close the plugin and call it again; confirm `PLUGIN_NOT_CONNECTED` returns in about one second rather than hanging.
4. Reopen the plugin and confirm automatic reconnection.
5. Open two additional Codex tasks. Confirm all three tasks discover the same 19 tools and can call `figma_status` through the same plugin.
6. Close one task and confirm the other two remain connected. Run `bridge status` and confirm the client count changes without disconnecting the plugin.
7. Select the rough ArticleCard and call selection, node, tree, and render tools.
8. Confirm the normalized tree plus image is sufficient to identify row/column relationships and the overlay.

## 3. Primitive Proposal path

1. Build an Auto Layout list containing at least three cards. Record the list and cards' fingerprints, hierarchy, geometry, locks, and screenshot.
2. Call `figma_duplicate_as_proposal` with the middle card in `editTargetNodeIds`. Confirm the response resolves the list as an `AUTO_LAYOUT_PARENT`, maps the requested card, and places the Proposal as a Page child rather than inside the source list.
3. Confirm the source list and all cards retain their original fingerprints, order, geometry, visibility, and locks. Confirm the Proposal copy is recursively unlocked.
4. Modify both the requested card and a cloned sibling/context node. Confirm both succeed because the whole Proposal is writable, while a write using the original card ID returns `NODE_NOT_IN_PROPOSAL`.
5. Repeat with an absolute child, a Component Set variant, a leaf inside a Group, and two targets sharing one Auto Layout parent. Confirm the reported roots and resolution reasons match the documented rules and no root is cloned twice.
6. Use a generated context above 1000 nodes. Confirm inferred context falls back to the requested target with `CLONE_CONTEXT_TRUNCATED`; confirm a target whose own subtree exceeds the limit returns `LIMIT_EXCEEDED` without creating nodes.
7. Create a Content Frame inside the Proposal, reparent intended children with explicit `FLOW` or `ABSOLUTE`, and apply two or three Auto Layout levels.
8. Edit the Proposal manually, then attempt discard with its old fingerprint; confirm `PROPOSAL_CHANGED`. Read the new fingerprint and discard the whole Proposal.
9. Leave a marker-v1 Proposal on the page and confirm a write returns `PROPOSAL_VERSION_UNSUPPORTED` with no mutation.

## 4. Declarative LayoutPlan path

1. Form a v1 plan using the current source fingerprint and complete source coverage.
2. Validate it. Confirm no Figma node was created and capture the five-minute `validationId`.
3. Change the source, then apply the plan; confirm `PLAN_STALE` and no temporary Frame remains. Undo the manual source change.
4. Validate again and apply once; confirm a complete hidden-then-revealed Proposal appears to the right.
5. Reuse the same ID; confirm `VALIDATION_EXPIRED` because IDs are single-use.
6. Confirm overlays remain absolute and correctly placed.

## 5. Semantic and asset path

1. Update mixed-font text. If a required font is unavailable, confirm no characters or ranges changed.
2. Convert the Proposal root Frame to a Component and confirm its Proposal marker remains recognized after restarting the plugin.
3. Create or select an Instance in a Proposal and change exposed text/boolean/variant properties; confirm it remains an Instance.
4. Read CSS and confirm it is labeled as a hint; read local variables with at least two pages when enough variables exist.
5. Render the final Component and export PNG and SVG assets.
6. Confirm results include a temporary local path and SHA-256 and no file is written into the current front-end repository.

## 6. Natural-language Codex scenario

Use this acceptance prompt:

> Inspect the selected rough ArticleCard in Figma. Read its bounded tree and render, explain the current structure, then propose a LayoutPlan that preserves the source and overlay. Validate it, apply it as a Proposal, convert the Proposal root to a Component, re-read the result, and export its PNG and SVG assets. Stop and report any stale fingerprint or font problem instead of bypassing the safety check.

Pass criteria: source screenshot/fingerprint/hierarchy remain unchanged; the Proposal has expected Auto Layout; no Instance is detached; cancellation/failure leaves no temporary node; the plugin recognizes the Proposal after restart; exported artifacts are temporary and checksummed.

## Visual comparison

Figma renderer output can vary by version. Keep before/after PNGs for human review and inspect geometry numerically; do not require byte-identical cross-version pixels.
