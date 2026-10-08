# End-to-end acceptance runbook

[中文版](../zh-CN/acceptance.md) · [Documentation home](README.md)

This runbook is for contributors validating candidate distribution artifacts. Run `pnpm build:release` before manual acceptance and replace every `<VERSION>` on this page with the candidate version. Perform the user path from the generated Figma ZIP, npm tarball, and Agent Plugin ZIP, not from workspace entry points. Use a disposable Figma page for mutation scenarios.

## 1. Distribution and pairing gate

1. On a clean Windows account with Node.js 20+, inspect `artifacts/figma-agent-bridge-plugin-v<VERSION>.zip`, `figma-local-agent-mcp-<VERSION>.tgz`, `figma-local-agent-plugin-v<VERSION>.zip`, and the three matching entries in `SHA256SUMS`.
2. Extract the Figma plugin ZIP and import its `manifest.json` in Figma Desktop without editing the ID.
3. Start the plugin and confirm there is no secret or Plugin ID input.
4. Run `npm exec --yes --package="file:./artifacts/figma-local-agent-mcp-<VERSION>.tgz" -- figma-local-agent-mcp pair`.
5. Confirm both surfaces show the same six-digit code, click **Codes match**, and verify the CLI reports success.
6. Restart Figma and the MCP host; confirm the plugin reconnects without another pairing.
7. Run `devices list`, revoke the connected device, and confirm the plugin immediately returns to the pairing screen.
8. Run `pnpm check:agent-marketplaces`. Confirm the three canonical indexes and the generated Codex, Cursor, and Copilot entry points are synchronized.
9. After npm `<VERSION>` and GitHub tag `v<VERSION>` are public, run `codex plugin marketplace add Lancasteerr/figma_bridge_agent --ref v<VERSION>`, install **Local Figma Agent** through `/plugins`, start a new session, and confirm exactly 23 tools and the bundled Skill are discovered without manual MCP configuration.
10. In Copilot CLI, run `copilot plugin marketplace add Lancasteerr/figma_bridge_agent#v<VERSION>` and `copilot plugin install figma-local-agent@figma-local-agent`; start a new session and confirm the same 23 tools and Skill are available.
11. In a Cursor team, import `https://github.com/Lancasteerr/figma_bridge_agent` through **Dashboard → Plugins & MCPs → Add Marketplace → Import from Repo**. Install **Local Figma Agent** from **Customize** and confirm the same 23 tools and Skill are available.
12. In a clean Claude Code configuration without the Agent Plugin, register the stable npm release using the [direct MCP guide](install-mcp-server.md#claude-code). Confirm the same 23 tools are available but the **Local Figma Agent** Skill is not installed automatically.
13. Inspect the Agent Plugin ZIP and confirm it contains `skills/figma-local-agent/references/design-plan-v1.md` but none of the repository-level marketplace files.

Do not continue acceptance if this gate fails.

## 2. Connection and read path

1. Start Codex with the installed Agent Plugin. Then repeat the essential connection check in a separate Claude Code configuration without that plugin, following the [direct MCP guide](install-mcp-server.md). Each client must load exactly one `figma-local-agent` Server.
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
5. Repeat with a direct Page Rectangle, an absolute child, a Component Set variant, a leaf inside a Group, and two targets sharing one Auto Layout parent. Confirm non-Frame targets remain supported, the reported roots and resolution reasons match the documented rules, and no root is cloned twice.
6. Use a generated context above 1000 nodes. Confirm inferred context falls back to the requested target with `CLONE_CONTEXT_TRUNCATED`; confirm a target whose own subtree exceeds the limit returns `LIMIT_EXCEEDED` without creating nodes.
7. Create a Content Frame inside the Proposal, reparent intended children with explicit `FLOW` or `ABSOLUTE`, and apply two or three Auto Layout levels.
8. Edit the Proposal manually, then attempt discard with its old fingerprint; confirm `PROPOSAL_CHANGED`. Call `figma_get_fingerprint` for the Proposal root, then discard the whole Proposal with the returned complete-tree fingerprint.
9. Confirm an existing marker-v2 Proposal remains readable and writable. An unsupported marker version must return `PROPOSAL_VERSION_UNSUPPORTED` with no mutation.

## 4. Declarative DesignPlan path

1. Inspect `figma_validate_design_plan` in `tools/list`. Confirm `plan.root` resolves to a Proposal `FRAME` definition and its `children` reference all supported node kinds.
2. Inspect the MCP host's model-visible declaration. If recursive fields are simplified to `unknown`, confirm the Agent reads the bundled DesignPlan reference instead of probing the validator.
3. Form a v1 plan whose root is a 360 × 180 card Proposal with Auto Layout and text. Confirm the root is treated as an isolated technical container, not a Figma Page or complete screen.
4. Validate and apply the card once, render it, obtain its latest complete-tree fingerprint, and discard it. Confirm no source artwork changed.
5. For a source-backed plan, call `figma_get_fingerprint` with ordered roots that include a non-Frame Clone source and a reusable component/instance. Copy the same IDs and returned fingerprint into the source declaration; confirm reversing multiple roots changes the fingerprint.
6. Change one source, then apply the validated plan; confirm `PLAN_STALE` and no temporary Frame remains. Undo the manual source change.
7. Fetch a fresh aggregate fingerprint, validate the revised candidate once, and apply it; confirm a complete hidden-then-revealed Proposal appears to the right and `refMap` covers every planned node.
8. Reuse the same ID; confirm `VALIDATION_EXPIRED` because IDs are single-use.
9. Repeat with a larger design containing nested Auto Layout, shapes, fixed-width/auto-height text, gradients, strokes, corners, effects, and an absolute overlay. Confirm overlays remain correctly placed. Verify exactly 1000 nodes/depth 32, then confirm one additional node/level is rejected.

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

> Inspect the selected rough ArticleCard and a reference web page. Read the bounded tree, render, fonts, and current-page design resources. Before constructing a DesignPlan, read the bundled DesignPlan v1 reference. Fetch the ordered complete-tree fingerprint for all source roots. Provide any required image/SVG as Base64, build one complete candidate without querying Team Library, validate it once, apply it as an isolated Proposal, re-read and render the result. Stop on stale dependencies, asset errors, resource conflicts, or unavailable explicit fonts instead of bypassing validation.

Pass criteria: source screenshot/fingerprint/hierarchy remain unchanged; the Proposal has expected Auto Layout; no Instance is detached; cancellation/failure leaves no temporary node; the plugin recognizes the Proposal after restart; exported artifacts are temporary and checksummed.

## Visual comparison

Figma renderer output can vary by version. Keep before/after PNGs for human review and inspect geometry numerically; do not require byte-identical cross-version pixels.
