# Asset export workflow

Use this reference only when implementing a front-end or another deliverable that needs files from
the current Figma document. `figma_render_node` remains a visual inspection tool; it is not the
project asset delivery path.

## Planning phase

1. Call `figma_status` and record `workspace.state` plus `workspace.sessionId`.
2. Use a shallow `figma_get_tree` only to find candidates from `assetHints`, then call
   `figma_get_node` for each candidate whose exact treatment affects the result. Under that node
   snapshot's `assets`:
   - `imagePaints` identifies `FILLS`/`STROKES`, zero-based paint indices, image hashes, original
     dimensions, crop/tile transforms, filters, opacity, blend mode, and visibility.
   - `exportSettings` reports the author-configured Figma export facts.
   - `vector` and `mask` report path/segment counts and mask state.
3. Inspect the implementation project before deciding that a new file is necessary.
4. Choose the delivery form:
   - use code for text, layout, interaction, and ordinary CSS shapes;
   - use `RAW` for original Image Paint bytes when CSS can reproduce crop, radius, opacity,
     filters, and layout; or
   - use `RENDERED` for a distinctive logo, complex vector, mask, or compositing that must be baked.
5. Record each chosen source and destination. Planning must not call `figma_export_assets`.

Do not treat tree `assetHints` as export facts: counts and booleans intentionally omit image hashes,
dimensions, transforms, filters, and exact export settings. If a temporary tree JSONL is returned,
filter only the few candidate records needed for the decision instead of reading the whole file.

## Implementation phase

Follow the shared binding procedure in `SKILL.md` before the first asset or semantic write. Asset
and semantic writes share one immutable Adapter-session binding; do not attempt an export when the
session is unbound.

Re-read the chosen nodes, then make one `figma_export_assets` call for the task-shaped batch. A
batch contains 1–32 items, every resolved destination must be unique, and decoded staged content
must stay within 64 MiB. The bridge validates every item and source before atomically committing the
batch; one failure returns one structured error and leaves project files unchanged.

For each `RAW` item provide:

- `mode: "RAW"`;
- the exact `paintSlot` and `paintIndex`;
- an extensionless `outputPathStem`.

The tool returns original PNG, JPEG, GIF, or WebP bytes and appends the detected extension. It does
not reproduce crop, filters, masks, or other compositing; implement those effects in code or choose
`RENDERED`.

For each `RENDERED` item provide:

- `mode: "RENDERED"` and the source `nodeId`;
- `PNG` or `JPG` with optional scale from 1 through 4, or `SVG` without scale;
- a matching relative extension: `.png`, `.jpg`/`.jpeg`, or `.svg`.

When the assets come from an active semantic scope, pass one `sourceGuard` containing that scope's
`rootNodeId` and `sourceFingerprint`. Every item must be inside the guard root, and the same source
fingerprint must match before and after the whole batch. Do not fetch or pass node, image, or tree
fingerprints for individual items. Without a guard, the plugin still checks each item's source
before and after its own export.

The result contains `assets` in input order. Each entry returns workspace-relative `path`, write
`status`, `mimeType`, `width`, `height`, and `dimensionUnit`—never Base64, SVG text, absolute paths,
hashes, or source identifiers. RAW and rendered bitmap dimensions use `PIXEL`; SVG dimensions use
`FIGMA_UNIT`. Handle status as follows:

- `CREATED`: use the new file.
- `REUSED`: the existing file already has identical bytes.
- `UPDATED`: an explicitly authorized hash-checked overwrite succeeded.

Resolve `path` below the root returned by `figma_bind_export_root`. The bridge still computes and
compares digests internally, but does not expose them in successful results.

If Figma changes, the tool returns `ASSET_SOURCE_CHANGED` without writing. Re-inspect and revise the
implementation instead of retrying with stale identifiers. If a destination differs, the default
policy returns `EXPORT_TARGET_CONFLICT`; inspect the existing project file and calculate its
SHA-256 locally before considering `OVERWRITE` with `expectedExistingSha256`. Conflict errors do
not reveal the existing or incoming digest.
