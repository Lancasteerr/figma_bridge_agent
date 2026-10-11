# Asset export workflow

Use this reference only when implementing a front-end or another deliverable that needs files from
the current Figma document. `figma_render_node` remains a visual inspection tool; it is not the
project asset delivery path.

## Planning phase

1. Call `figma_status` and record whether `assetExport.delivery` is `WORKSPACE` or `STAGED`.
2. Read the smallest useful node or subtree. Under each snapshot's `assets`:
   - `imagePaints` identifies `FILLS`/`STROKES`, zero-based paint indices, image hashes, original
     dimensions, crop/tile transforms, filters, opacity, blend mode, and visibility.
   - `exportSettings` reports the author-configured Figma export facts.
   - `vector` and `mask` report path/segment counts and mask state.
3. Inspect the implementation project before deciding that a new file is necessary.
4. Choose code, `RAW`, or `RENDERED` using the decision criteria in `SKILL.md`.
5. Record each chosen source and destination. Planning must not call `figma_export_asset`.

## Implementation phase

Before the first asset export or semantic snapshot write:

1. Call `figma_status` again and record the current `assetExport.sessionId`.
2. Obtain the exact absolute `process.cwd()` from the Agent's own local task execution environment.
   Do not infer a root from the plugin process, plugin cache, Git metadata, or user-provided prose.
3. Call `figma_bind_export_root` with that path and `expectedSessionId`. Asset and semantic writes
   share one immutable Adapter-session binding, so binding must happen before either starts. If local
   execution is unavailable or binding fails, keep the session `STAGED` and use the copy-and-hash
   workflow below.

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

Both modes return only paths, hashes, dimensions, and source identifiers—never Base64 or SVG text.
Handle results as follows:

- `CREATED`: use the new file.
- `REUSED`: the existing file already has identical bytes.
- `UPDATED`: an explicitly authorized hash-checked overwrite succeeded.
- `WORKSPACE`: `absolutePath` is already the requested `projectRelativePath` below the session-bound
  Agent workspace root.
- `STAGED`: copy from `absolutePath` to `projectRelativePath` and verify SHA-256. Staged sessions are
  retained for 24 hours but are not project asset directories.

If Figma changes, the tool returns `ASSET_SOURCE_CHANGED` before writing. Re-inspect and revise the
implementation instead of retrying with stale identifiers. If a destination differs, the default
policy returns `EXPORT_TARGET_CONFLICT`; inspect it before considering a hash-checked overwrite.
