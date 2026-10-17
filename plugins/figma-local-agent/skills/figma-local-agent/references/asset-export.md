# Asset export

Read this reference when a front-end workunit needs Figma-derived project files.
`figma_inspect_render_preview` is temporary inspection output, not project delivery.

## Decide before writing

Inspect candidates with `figma_inspect_browse_nodes` and targeted
`figma_inspect_read_node_facts` calls. Tree `assetHints` are counts and booleans only; the node's
`assetSources` fields contain exact paint, export, vector, and mask facts.

Choose:

- code for text, layout, interaction, and ordinary CSS shapes;
- `RAW` for original Image Paint bytes when code can reproduce crop, radius, opacity, filters,
  masks, and layout;
- `RENDERED` for a distinctive icon/logo, complex vector, mask, or baked compositing.

Planning must not call `figma_frontend_export_assets`.

## Export atomically

At implementation time, follow the one workspace-binding procedure in [SKILL.md](../SKILL.md),
re-read chosen nodes, and send one task-shaped `figma_frontend_export_assets` batch with the active
`workUnitId`. Use unique
workspace-relative destinations. A batch has 1–32 items and at most 64 MiB decoded content. Every
source and payload is validated before the atomic write; one failure leaves all project files
unchanged.

For `RAW`, provide the exact `paintSlot`, zero-based `paintIndex`, and extensionless
`outputPathStem`. The bridge appends the detected PNG/JPEG/GIF/WebP extension. RAW does not bake
crop, filters, masks, or compositing.

For `RENDERED`, provide `PNG` or `JPG` with scale 1–4, or `SVG` without scale, plus a matching
relative extension.

The server resolves the root and implementation fingerprint from the workunit. It rejects export
when `implementation.json.sourceFingerprint` differs from `source/current.json`; never assemble a
source guard or per-item fingerprint chain.

## Read the result correctly

Results stay in input order and expose only relative `path`, `status`, `mimeType`,
`intrinsicWidth`, `intrinsicHeight`, and `dimensionUnit`.

- Raster and RAW dimensions are actual pixels decoded from final bytes.
- SVG dimensions are the final root `width`/`height`; absent valid values fall back to
  `viewBox`. They are `FIGMA_UNIT`.
- Source-node logical dimensions come from `figma_inspect_read_node_facts`, not the export result.
- Never rescale an exported SVG from an internal path's dimensions.

`CREATED` is new, `REUSED` is byte-identical, and `UPDATED` is an explicitly authorized
hash-checked overwrite. Resolve returned paths under the bound root.

On `ASSET_SOURCE_CHANGED`, re-inspect instead of retrying stale identifiers. On
`EXPORT_TARGET_CONFLICT`, inspect the existing file and calculate its SHA-256 locally before
considering `OVERWRITE` with `expectedExistingSha256`.
