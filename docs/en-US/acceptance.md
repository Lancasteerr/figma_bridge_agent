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
9. After npm `<VERSION>` and GitHub tag `v<VERSION>` are public, run `codex plugin marketplace add Lancasteerr/figma_bridge_agent --ref v<VERSION>`, install **Local Figma Agent** through `/plugins`, start a new session, and confirm all 25 static tools and the bundled Skill are discovered without manual MCP configuration.
10. In Copilot CLI, run `copilot plugin marketplace add Lancasteerr/figma_bridge_agent#v<VERSION>` and `copilot plugin install figma-local-agent@figma-bridge-marketplace`; start a new session and confirm the same static tools and Skill are available.
11. In a Cursor team, import `https://github.com/Lancasteerr/figma_bridge_agent` through **Dashboard → Plugins & MCPs → Add Marketplace → Import from Repo**. Install **Local Figma Agent** from **Customize** and confirm the same static tools and Skill are available.
12. In a clean Claude Code configuration without the Agent Plugin, register the stable npm release using the [direct MCP guide](install-mcp-server.md#claude-code). Confirm the same static tools are available but the **Local Figma Agent** Skill is not installed automatically.
13. Inspect the Agent Plugin ZIP and confirm it contains `skills/figma-local-agent/references/design-plan-v1.md`, `skills/figma-local-agent/references/asset-export.md`, `skills/figma-local-agent/references/frontend-implementation.md`, and `skills/figma-local-agent/references/workunits.md`, but none of the repository-level marketplace files.

Do not continue acceptance if this gate fails.

## 2. Connection and read path

1. Start Codex with the installed Agent Plugin. Then repeat the essential connection check in a separate Claude Code configuration without that plugin, following the [direct MCP guide](install-mcp-server.md). Each client must load exactly one `figma-local-agent` Server.
2. Confirm the list contains exactly 25 static tools grouped by inspect, frontend, and design prefixes; every legacy tool name must be rejected. Call `figma_status`; confirm protocol 11 was accepted internally and the public result contains only document/page metadata, selection summary, and an `UNBOUND` workspace with its session ID. A 2.9.2/protocol-10 plugin or server must fail clearly instead of mixing with protocol 11.
3. Close the plugin and call it again; confirm `PLUGIN_NOT_CONNECTED` returns in about one second rather than hanging.
4. Reopen the plugin and confirm automatic reconnection.
5. Open two additional Codex tasks. Confirm all three tasks discover the same 25 static tools and can call `figma_status` through the same plugin.
6. Confirm `figma_activate_workflow` is absent and no tool call triggers `notifications/tools/list_changed`; every task keeps the same tool set.
7. Close one task and confirm the other two remain connected. Run `bridge status` and confirm the client count changes without disconnecting the plugin.
8. Select the rough ArticleCard, use the selection returned by `figma_status`, and call `figma_inspect_read_node_facts`, `figma_inspect_browse_nodes`, and `figma_inspect_render_preview`. Confirm the old selection and variables tools are absent.
9. Confirm `figma_inspect_read_node_facts` accepts stable field groups, returns name/type/parent unconditionally, omits `DIRECT_CHILDREN` unless requested, and removes default booleans, zero rotation, empty collections, invalid mask shells, duplicate render bounds, and any public source fingerprint. Verify Auto Layout/Grid, size constraints, child alignment, text truncation and styles, strokes, independent corners, true render bounds, and asset facts remain available when requested. Treat clipping and overflow only as static facts; do not claim page, container, sticky, or other scrolling behavior from them.
10. Call `figma_inspect_read_raw_fields` and confirm the default omits `children`; `depth: 1` keeps one level only, `fields` accepts at most 32 unique top-level fields while always retaining `id`, `name`, and `type`, and projection precedes the 256 KiB/2 MiB byte check. Simulate an empty image hash, missing image, and dimension-query failure. Confirm paint location plus error state remain and the node read succeeds. Change layout, text, shape, image, crop, vector, mask, or export-setting facts and confirm a new workunit source receives a different `sourceFingerprint` while node facts still expose none.

## 3. Primitive Proposal path

1. Build an Auto Layout list containing at least three cards. Record the list and cards' fingerprints, hierarchy, geometry, locks, and screenshot.
2. Call `figma_design_duplicate_as_proposal` with the middle card in `editTargetNodeIds`. Confirm the response resolves the list as an `AUTO_LAYOUT_PARENT`, maps the requested card, and places the Proposal as a Page child rather than inside the source list.
3. Confirm the source list and all cards retain their original fingerprints, order, geometry, visibility, and locks. Confirm the Proposal copy is recursively unlocked.
4. Modify both the requested card and a cloned sibling/context node. Confirm both succeed because the whole Proposal is writable, while a write using the original card ID returns `NODE_NOT_IN_PROPOSAL`.
5. Repeat with a direct Page Rectangle, an absolute child, a Component Set variant, a leaf inside a Group, and two targets sharing one Auto Layout parent. Confirm non-Frame targets remain supported, `targetMap` contains only requested targets and their resolution reasons, and internal clone roots/full ID mappings are not returned.
6. Use a generated context above 1000 nodes. Confirm inferred context falls back to the requested target with `CLONE_CONTEXT_TRUNCATED`; confirm a target whose own subtree exceeds the limit returns `LIMIT_EXCEEDED` without creating nodes.
7. Create a Content Frame inside the Proposal, reparent intended children with explicit `FLOW` or `ABSOLUTE`, and apply two or three Auto Layout levels.
8. Edit the Proposal manually, then attempt discard with its old fingerprint; confirm `PROPOSAL_CHANGED`. Call `figma_design_read_source_fingerprint` for the Proposal root, then discard the whole Proposal with the returned complete-tree fingerprint.
9. Confirm an existing marker-v2 Proposal remains readable and writable. An unsupported marker version must return `PROPOSAL_VERSION_UNSUPPORTED` with no mutation.

## 4. Declarative DesignPlan path

1. Inspect `figma_design_validate_plan` in `tools/list`. Confirm the public `plan` is compact generic JSON without recursive node definitions, while `returnRefs` remains public.
2. Confirm the Agent reads the complete structure from the bundled DesignPlan reference. Submit both a valid plan and one missing required fields; confirm the server's complete internal `DesignPlanSchema` strictly accepts the former and rejects the latter instead of relying on the Agent to probe the validator.
3. Form a v1 plan whose root is a 360 × 180 card Proposal with Auto Layout and text. Confirm the root is treated as an isolated technical container, not a Figma Page or complete screen.
4. Validate and apply the card once, render it, obtain its latest complete-tree fingerprint, and discard it. Confirm no source artwork changed.
5. For a source-backed plan, call `figma_design_read_source_fingerprint` with ordered roots that include a non-Frame Clone source and a reusable component/instance. Copy the same IDs and returned fingerprint into the source declaration; confirm reversing multiple roots changes the fingerprint.
6. Change one source, then apply the validated plan; confirm `PLAN_STALE` and no temporary Frame remains. Undo the manual source change.
7. Fetch a fresh aggregate fingerprint, validate the revised candidate once with a selected node ref and resource ref in `returnRefs`, and apply it. Confirm a complete hidden-then-revealed Proposal appears to the right and `refMap` contains only those selected refs. Repeat without `returnRefs` and confirm `refMap` is omitted; reject unknown, duplicate, and more than 200 refs.
8. Reuse the same ID; confirm `VALIDATION_EXPIRED` because IDs are single-use.
9. Repeat with a larger design containing nested Auto Layout, shapes, fixed-width/auto-height text, gradients, strokes, corners, effects, and an absolute overlay. Confirm overlays remain correctly placed. Verify exactly 1000 nodes/depth 32, then confirm one additional node/level is rejected.

## 5. Workunit and asset path

1. List fonts and validate mixed-font text under STRICT and ALLOW_FALLBACK policies. Confirm only explicitly listed fallbacks are used and missing fonts create no partial result.
2. Stage valid PNG/JPEG/GIF/SVG assets, use every image scale mode, and confirm the public handle and DesignPlan reference use only `assetId` (plus optional dimensions and expiry in the staging result). Reject forged MIME, damaged/oversized files, malicious SVG, expired IDs, and missing assets; confirm internal digest checks and deduplication still work.
3. Call `figma_inspect_read_design_resources`; confirm local styles/variables and current-page Component/Component Set/Instance entries are paginated. Confirm no other page or Team Library item is returned.
4. Create Paint/Text/Effect/Grid styles and one-mode COLOR/FLOAT/STRING/BOOLEAN variables. Confirm `Agent/<Proposal>/...` names, identical-resource reuse, different-content conflict, bindings, and that only requested resource refs appear in the merged `refMap`.
5. Create an Instance from a current-page Component and clone an imported Instance already on the current page. Set exposed text/boolean/variant/instance-swap values; reject non-current-page sources and never detach an Instance.
6. Force a mid-build exception and confirm node/resource cleanup. Simulate a `BUILDING` marker and confirm the next write recovers it. Discard a successful Proposal and confirm committed resources remain.
7. In planning mode, inspect a cropped avatar, background, multiple Image Fills, image stroke, multi-vector logo, mask, and blend effects. Record implementation choices, paint locations, formats, and relative paths. Confirm the project gains no file and no per-item fingerprint chain is assembled.
8. Call `figma_frontend_index_scope` for a large root and confirm it writes only a structural index. Call `figma_frontend_prepare_workunit` for a bounded root and confirm a stable `workUnitId`, immutable source revision, `source/current.json`, and one-time `implementation.json`; repeated preparation and source refresh must not change the implementation file bytes.
9. After starting the Agent Plugin, call `figma_status` and confirm the initial state is an independent `UNBOUND` session with no staging export directory. Have the Agent obtain the exact absolute cwd from its own task execution environment and call `figma_frontend_bind_workspace` with the latest `workspace.sessionId`; confirm the state changes to `BOUND` at the real project. Export avatar/background RAW items and a rendered SVG using `workUnitId`. Confirm PNG/JPEG/GIF/WebP use magic-detected extensions without crop/filter composition or transcoding, SVG rejects scale, rendered extensions must match, and result entries include MIME, final-file intrinsic dimensions, and `PIXEL`/`FIGMA_UNIT`. For the SVG fixture, confirm a source node at `18.75 × 17.835` with a final `23 × 22` canvas returns `23 × 22`; cover numeric attributes, `px` attributes, and `viewBox` fallback. Missing valid SVG dimensions must return a structured format error and preserve batch atomicity. `figma_inspect_render_preview` pixel dimensions must likewise match the final PNG bytes.
10. In a new unbound MCP Adapter, confirm `figma_status` reports an independent `UNBOUND` session. Binding with a wrong session ID, relative path, filesystem root, user home, or plugin directory must return stable errors; repeated binding to the same root is idempotent, while rebinding returns `EXPORT_ROOT_CONFLICT`. Keep this Adapter unbound and confirm asset, index, and workunit writes return `EXPORT_ROOT_UNBOUND`, while tree artifacts and renders still work from their temporary store.
11. Change the Figma image hash, crop parameters, or a Logo descendant and export through a workunit whose implementation fingerprint is stale. Confirm the request is rejected with no output; a node outside the workunit root must also fail without writing.
12. Repeat identical output and confirm `REUSED`. Change the local target and use the default policy; confirm `EXPORT_TARGET_CONFLICT` without modification.
13. Inspect the existing SHA-256, then pass `OVERWRITE` with that digest and confirm `UPDATED`. Reject wrong or stale digests. Duplicate resolved paths, target conflicts, or a mid-batch failure must roll back the complete batch and leave no partial target, backup, or staging file.
14. Try an absolute path, drive path, UNC path, `..`, NUL, symlink/junction escape, directory, and other non-regular target. Reject each before writing. Confirm public MCP results contain no Base64 or SVG body.
15. Reject a 33-item asset batch and decoded staging above 64 MiB. Confirm the transient session staging directory is removed after success and failure. Expire temporary tree/render artifacts and confirm their separate TTL/quota behavior is unchanged.

## 6. Natural-language Codex scenario

Use this acceptance prompt:

> Call `figma_status` first. Inspect the selected rough ArticleCard and a reference web page. Read the bounded tree, render, fonts, and current-page design resources. Before constructing a DesignPlan, read the bundled DesignPlan v1 reference. Fetch the ordered complete-tree fingerprint for all source roots. Provide any required image/SVG as Base64, build one complete candidate without querying Team Library, validate it once, apply it as an isolated Proposal, re-read and render the result. Stop on stale dependencies, asset errors, resource conflicts, or unavailable explicit fonts instead of bypassing validation.

Pass criteria: source screenshot/fingerprint/hierarchy remain unchanged; the Proposal has expected Auto Layout; no Instance is detached; cancellation/failure leaves no temporary node; the plugin recognizes the Proposal after restart; implementation assets are safely delivered under the current Adapter's bound workspace, and public results contain no asset body, digest, internal path, or input echo.

## Visual comparison

Figma renderer output can vary by version. Keep before/after PNGs for human review and inspect geometry numerically; do not require byte-identical cross-version pixels.
