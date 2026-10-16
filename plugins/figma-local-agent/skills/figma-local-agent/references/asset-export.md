# Asset export

Read this reference only in `FRONTEND` when the deliverable needs Figma-derived project files.
`figma_render_node` is temporary inspection output, not project delivery.

## Decide before writing

Inspect candidates with a shallow tree and targeted `figma_get_node` calls. Tree `assetHints`
are counts and booleans only; the node's `assets` fields contain exact paint, export, vector, and
mask facts. Inspect the repository before deciding a new file is needed.

Choose:

- code for text, layout, interaction, and ordinary CSS shapes;
- `RAW` for original Image Paint bytes when code can reproduce crop, radius, opacity, filters,
  masks, and layout;
- `RENDERED` for a distinctive icon/logo, complex vector, mask, or baked compositing.

Planning must not call `figma_export_assets`.

## Export atomically

At implementation time, follow the one workspace-binding procedure in [SKILL.md](../SKILL.md),
re-read chosen nodes, and send one task-shaped `figma_export_assets` batch. Use unique
workspace-relative destinations. A batch has 1–32 items and at most 64 MiB decoded content. Every
source and payload is validated before the atomic write; one failure leaves all project files
unchanged.

For `RAW`, provide the exact `paintSlot`, zero-based `paintIndex`, and extensionless
`outputPathStem`. The bridge appends the detected PNG/JPEG/GIF/WebP extension. RAW does not bake
crop, filters, masks, or compositing.

For `RENDERED`, provide `PNG` or `JPG` with scale 1–4, or `SVG` without scale, plus a matching
relative extension.

When exporting from an active semantic scope, pass one `sourceGuard` with its `rootNodeId` and
`sourceFingerprint`. It checks membership and the same source before and after the entire batch.
Do not build per-item fingerprint chains.

## Read the result correctly

Results stay in input order and expose only relative `path`, `status`, `mimeType`, `width`,
`height`, and `dimensionUnit`.

- Raster and RAW dimensions are actual pixels decoded from final bytes.
- SVG dimensions are the final root `width`/`height`; absent valid values fall back to
  `viewBox`. They are `FIGMA_UNIT`.
- Source-node logical dimensions come from `figma_get_node`, not the export result.
- Never rescale an exported SVG from an internal path's dimensions.

`CREATED` is new, `REUSED` is byte-identical, and `UPDATED` is an explicitly authorized
hash-checked overwrite. Resolve returned paths under the bound root.

On `ASSET_SOURCE_CHANGED`, re-inspect instead of retrying stale identifiers. On
`EXPORT_TARGET_CONFLICT`, inspect the existing file and calculate its SHA-256 locally before
considering `OVERWRITE` with `expectedExistingSha256`.
