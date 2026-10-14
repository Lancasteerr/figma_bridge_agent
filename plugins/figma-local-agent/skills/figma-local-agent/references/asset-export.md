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
5. Record each chosen source and destination. Planning must not call `figma_export_asset`.

Do not treat tree `assetHints` as export facts: counts and booleans intentionally omit image hashes,
dimensions, transforms, filters, and exact export settings. If a temporary tree JSONL is returned,
filter only the few candidate records needed for the decision instead of reading the whole file.

## Implementation phase

Follow the shared binding procedure in `SKILL.md` before the first asset or semantic write. Asset
and semantic writes share one immutable Adapter-session binding; do not attempt an export when the
session is unbound.

For `RAW`, re-read the node and call `figma_export_asset` with:

- `mode: "RAW"`;
- the exact `paintSlot` and `paintIndex`;
- the current `expectedImageHash` and node snapshot `expectedNodeFingerprint`;
- an extensionless `outputPathStem`.

The tool returns original PNG, JPEG, GIF, or WebP bytes and appends the detected extension. It does
not reproduce crop, filters, masks, or other compositing; implement those effects in code or choose
`RENDERED`.

For `RENDERED`, call `figma_get_fingerprint` with the single source node immediately before export,
then call `figma_export_asset` with:

- `mode: "RENDERED"` and the returned `expectedTreeFingerprint`;
- `PNG` or `JPG` with optional scale from 1 through 4, or `SVG` without scale;
- a matching relative extension: `.png`, `.jpg`/`.jpeg`, or `.svg`.

Both modes return only a workspace-relative `path` and write `status`—never Base64, SVG text,
absolute paths, hashes, dimensions, or source identifiers. Handle status as follows:

- `CREATED`: use the new file.
- `REUSED`: the existing file already has identical bytes.
- `UPDATED`: an explicitly authorized hash-checked overwrite succeeded.

Resolve `path` below the root returned by `figma_bind_export_root`. The bridge still computes and
compares digests internally, but does not expose them in successful results.

If Figma changes, the tool returns `ASSET_SOURCE_CHANGED` before writing. Re-inspect and revise the
implementation instead of retrying with stale identifiers. If a destination differs, the default
policy returns `EXPORT_TARGET_CONFLICT`; inspect the existing project file and calculate its
SHA-256 locally before considering `OVERWRITE` with `expectedExistingSha256`. Conflict errors do
not reveal the existing or incoming digest.
