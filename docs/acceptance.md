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
2. Call `figma_status`; confirm authenticated protocol v4, file/page metadata, selection summary, and the `design-plan-v1`, `asset-staging-v1`, `font-catalog-v1`, and `design-resources-v1` capabilities.
3. Close the plugin and call it again; confirm `PLUGIN_NOT_CONNECTED` returns in about one second rather than hanging.
4. Reopen the plugin and confirm automatic reconnection.
5. Open two additional Codex tasks. Confirm all three tasks discover the same 23 tools and can call `figma_status` through the same plugin.
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
8. Edit the Proposal manually, then attempt discard with its old fingerprint; confirm `PROPOSAL_CHANGED`. Call `figma_get_fingerprint` for the Proposal root, then discard the whole Proposal with the returned complete-tree fingerprint.
9. Confirm an existing marker-v2 Proposal remains readable and writable. An unsupported marker version must return `PROPOSAL_VERSION_UNSUPPORTED` with no mutation.

## 4. Declarative DesignPlan path

1. Form a v1 plan whose root is a 1440 px Frame and includes nested Auto Layout, shapes, fixed-width/auto-height text, gradients, strokes, corners, effects, and an absolute overlay. A source declaration is optional.
2. For a source-backed plan, call `figma_get_fingerprint` with the ordered roots and copy the same IDs and returned fingerprint into the source declaration. Confirm reversing multiple roots changes the fingerprint.
3. Validate it. Confirm no Figma node was created and capture the five-minute `validationId`.
4. Change the source, then apply the plan; confirm `PLAN_STALE` and no temporary Frame remains. Undo the manual source change.
5. Fetch a fresh aggregate fingerprint, validate again, and apply once; confirm a complete hidden-then-revealed Proposal appears to the right and `refMap` covers every planned node.
6. Reuse the same ID; confirm `VALIDATION_EXPIRED` because IDs are single-use.
7. Confirm overlays remain absolute and correctly placed. Repeat with exactly 1000 nodes/depth 32, then confirm one additional node/level is rejected.

## 5. Semantic and asset path

1. List fonts and validate mixed-font text under STRICT and ALLOW_FALLBACK policies. Confirm only explicitly listed fallbacks are used and missing fonts create no partial result.
2. Stage valid PNG/JPEG/GIF/SVG assets, use every image scale mode, and confirm the applied digest. Reject forged MIME, damaged/oversized files, malicious SVG, expired IDs, and digest mismatch.
3. Call `figma_get_design_resources`; confirm local styles/variables and current-page Component/Component Set/Instance entries are paginated. Confirm no other page or Team Library item is returned.
4. Create Paint/Text/Effect/Grid styles and one-mode COLOR/FLOAT/STRING/BOOLEAN variables. Confirm `Agent/<Proposal>/...` names, identical-resource reuse, different-content conflict, bindings, and `resourceMap`.
5. Create an Instance from a current-page Component and clone an imported Instance already on the current page. Set exposed text/boolean/variant/instance-swap values; reject non-current-page sources and never detach an Instance.
6. Force a mid-build exception and confirm node/resource cleanup. Simulate a `BUILDING` marker and confirm the next write recovers it. Discard a successful Proposal and confirm committed resources remain.
7. Render the final root and export PNG and SVG assets. Confirm temporary paths/SHA-256 and no file in the front-end repository.

## 6. Natural-language Codex scenario

Use this acceptance prompt:

> Inspect the selected rough ArticleCard and a reference web page. Read the bounded tree, render, fonts, and current-page design resources. Fetch the ordered complete-tree fingerprint for all source roots. Provide any required image/SVG as Base64, build a complete DesignPlan without querying Team Library, validate it, apply it as an isolated Proposal, re-read and render the result. Stop on stale dependencies, asset errors, resource conflicts, or unavailable explicit fonts instead of bypassing validation.

Pass criteria: source screenshot/fingerprint/hierarchy remain unchanged; the Proposal has expected Auto Layout; no Instance is detached; cancellation/failure leaves no temporary node; the plugin recognizes the Proposal after restart; exported artifacts are temporary and checksummed.

## Visual comparison

Figma renderer output can vary by version. Keep before/after PNGs for human review and inspect geometry numerically; do not require byte-identical cross-version pixels.
