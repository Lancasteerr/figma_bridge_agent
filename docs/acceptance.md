# End-to-end acceptance runbook

Run `pnpm check` before manual acceptance. Use a disposable Figma page for generated fixtures. `E:/codes/java/easy_community/Community.fig` may be used as an additional local scenario but must not be copied into this repository or CI.

## 1. Desktop smoke gate

1. Put the Figma-generated Development Plugin ID in `.figma-plugin-id`, build, and import `apps/figma-plugin/dist/manifest.json` in Figma Desktop. Do not use the CI placeholder ID.
2. Start the plugin and paste the secret printed by `setup`.
3. Select a visible Frame and click **Duplicate selection (smoke test)**.
4. Confirm the original layer, hierarchy, and appearance are unchanged.
5. Confirm the copy is placed to the right and renamed with `/ Smoke Proposal`.
6. Use Figma native Undo once and confirm only the smoke copy disappears.

Do not continue acceptance if this gate fails.

## 2. Connection and read path

1. Start Codex with the configuration in `docs/hosts.md`.
2. Call `figma_status`; confirm authenticated protocol v1, file/page metadata, and selection summary.
3. Close the plugin and call it again; confirm `PLUGIN_NOT_CONNECTED` returns in about one second rather than hanging.
4. Reopen the plugin and confirm automatic reconnection.
5. Select the rough ArticleCard and call selection, node, tree, and render tools.
6. Confirm the normalized tree plus image is sufficient to identify row/column relationships and the overlay.

## 3. Primitive Proposal path

1. Record the source root fingerprint, hierarchy, and screenshot.
2. Duplicate it with `figma_duplicate_as_proposal`.
3. Create a Content Frame inside the Proposal.
4. Reparent intended children, explicitly choosing `FLOW` or `ABSOLUTE` under Auto Layout.
5. Apply two or three Auto Layout levels with `figma_set_layout`.
6. Re-read source and Proposal. Confirm the source fingerprint is unchanged and important child geometry drift is at most 1 px.
7. Edit the Proposal manually, then attempt discard with its old fingerprint; confirm `PROPOSAL_CHANGED`.
8. Read the new fingerprint and discard; confirm the whole Proposal is removed.

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
