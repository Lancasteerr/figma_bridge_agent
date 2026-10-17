# Front-end implementation

This reference defines how Figma evidence becomes front-end code. Read
[workunits](workunits.md) before writing visual implementation code.

## Set the boundary

Honor an explicit request for exact reproduction, adaptation, or an existing design system. If the
priority is unstated, default to high fidelity and record the assumption in `implementation.json`.

Figma establishes visible layout, text, styling, assets, clipping, and materialized states. It does
not establish navigation, network calls, persistence, responsive reordering, scrolling ownership,
or unseen states. Inspect the repository for those contracts. Do not invent APIs, routes,
breakpoints, sticky regions, inner scrolling, or unseen loading/error states.

Exclude annotations, state boards, and neighboring reference frames unless the user includes them.

## Gather bounded evidence

- For a large page, call `figma_frontend_index_scope`, inspect its outline with line-oriented
  search, and choose a root that matches one repository responsibility.
- Every implementation range must call `figma_frontend_prepare_workunit`. Work on one workunit at a
  time; do not implement directly from a navigation tree or preview.
- Before writing visual code, add mappings for the components, selectors, assets, and special
  geometry that will actually produce code. Do not build a complete leaf ledger.
- Read `facts.jsonl` only by exact node ID or name. Never load the complete file into conversation.
- Use normalized facts as structural truth. CSS is a hint and raw fields are a targeted fallback.

## Interpret public fields

| Decision                                        | Field                                |
| ----------------------------------------------- | ------------------------------------ |
| Position and size inside the immediate parent   | `bounds.inParent`                    |
| Position on the Figma Page                      | `bounds.onPage`                      |
| Visible ink including outer strokes and shadows | `bounds.renderOnPage`                |
| Navigation-only tree boundary                   | `navigationBoundsInParent`           |
| Temporary preview pixels                        | `pixelWidth` / `pixelHeight`         |
| Exported file canvas                            | `intrinsicWidth` / `intrinsicHeight` |

Do not use navigation bounds as implementation facts. Export dimensions describe the final file's
intrinsic canvas; do not rescale an SVG from an internal path's bounds.

## Choose code or an asset

Read [asset export](asset-export.md) before writing a Figma-derived project file. Use code for text,
layout, interaction, and ordinary CSS shapes. Replace an icon with a repository icon only after its
silhouette, stroke/fill, view box, spacing, and optical alignment agree; otherwise export the exact
node. Record material adaptation differences in `unresolvedDifferences`.

## Completion gate

Call `figma_frontend_check_workunit_source` with only `workUnitId`. A `FRESH` result proves only
that the source used by `implementation.json` is unchanged. Confirm its fingerprint matches
`source/current.json`, resolve or explicitly report every difference, and perform one final
appearance check with a fresh Figma preview and the implementation state. Screenshots are final
evidence, not a separate acceptance system.

Only then set `state` to `COMPLETE`. Do not invent a model-level fidelity evaluator, leaf-risk
classifier, pixel-diff service, or another MCP acceptance tool.
