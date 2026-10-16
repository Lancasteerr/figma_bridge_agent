# Architecture and safety model

[中文版](../zh-CN/architecture.md) · [Documentation home](README.md)

The portable Agent Plugin is a distribution layer above the MCP host. It installs workflow guidance and the existing stdio launch configuration, but it is not a new runtime hop and does not receive Figma data or credentials. Removing it and configuring the same command manually produces the identical process and trust boundaries below. Because the bridge binds to local loopback, remote-only environments such as ChatGPT Web and Codex Cloud are outside this architecture.

## Process boundary

```text
MCP hosts (Codex / Claude Code / Cursor)
  ↕ independent stdio sessions (stdout is MCP only)
per-session MCP adapters
  ↕ authenticated ws://127.0.0.1:3900/mcp
single Bridge Daemon
  ↕ per-device authenticated ws://127.0.0.1:3900/
Figma plugin UI
  ↕ validated postMessage
Figma plugin main
  ↕ Figma Plugin API
current Design page
```

An explicit CLI pairing session temporarily enables `ws://127.0.0.1:3900/pair`; normal operation leaves that path closed.

`packages/protocol` owns transport-independent Zod schemas, including separate plugin RPC and public MCP result contracts. Each MCP adapter owns one stdio session, an initially unbound Agent workspace, and an independent export session ID. The automatically managed Bridge Daemon owns the loopback listener, forwards data only, and multiplexes any number of authenticated MCP adapters onto one plugin connection; it never writes a front-end project. Plugin UI owns plugin-side authentication and reconnect behavior. Plugin main is the only process allowed to hold Figma objects.

Each Adapter also owns independent workflow activation state. The Server registers all 25 tools and immediately disables workflow-specific handles, leaving only `figma_status` and `figma_activate_workflow` visible at cold start. Activation toggles SDK tool handles and the SDK sends `notifications/tools/list_changed`. The state is never persisted to disk, the Daemon, or the Figma plugin and disappears when the connection closes.

The first adapter starts the Daemon when needed. Closing one host only closes its adapter. The Daemon exits after both the last adapter and the plugin have been disconnected for 30 seconds.

## Trust boundaries

- The WebSocket server binds only to `127.0.0.1`, permits one authenticated plugin, and accepts multiple authenticated MCP adapters on a separate path.
- MCP adapters use an internal Daemon credential. Each plugin receives a separate X25519/HKDF-derived token after six-digit SAS confirmation, then uses fresh nonces plus role- and direction-specific HMAC-SHA-256 proofs. Credentials and proofs cannot be reused across roles.
- RPC envelopes and every UI/main message are schema-validated and size-limited.
- Adapter logs go to stderr. The detached Daemon writes a bounded `bridge.log` in the user configuration directory and retains one rotated file. Logs contain only request ID, RPC method, duration, and outcome; secrets, image base64, and raw node JSON are excluded.
- Visual previews from `figma_render_node` and large JSONL results from `figma_get_tree` go to `%TEMP%/figma-agent-mcp/<session-id>/`. This directory reuses the Adapter export session ID instead of creating a second temporary-session identity.
- The current Adapter retains temporary files for thirty minutes and removes them immediately on close. Other Adapters do not clean individual files or empty directories in that session. A live Adapter removes crashed-session directories after their `mtime` has remained stale for twenty-four hours. If this removes an old but still-running session directory, its Adapter recreates the directory on its next write.
- Assets and semantic snapshots are written by the Adapter and share one immutable session-root binding, path validation, and atomic writer. Every session starts `UNBOUND`. Asset batches use a transient session staging directory under the bound workspace and a 64 MiB batch limit; staging is removed after commit or failure. Before the first persistent write, the Agent must bind the exact absolute cwd from its own task execution environment with the latest session ID. The Adapter does not trust its own `process.cwd()`. Temporary tree and render files use the separate temporary store and remain available while unbound.

## Asset read and export lifecycle

1. Compact node reads enumerate Image Paint, export-setting, vector, and mask facts. Image dimensions are cached by hash during one serialization context, while internal canonical snapshots retain complete consistency fingerprints.
2. `figma_export_assets` accepts at most 32 RAW or RENDERED items. A guarded batch checks that every item is under one semantic-snapshot root and that its `sourceFingerprint` matches before and after the whole export. Without a guard, each item compares its internal source before and after export.
3. The plugin returns original bytes, rendered bytes, or an SVG string through protocol 10 RPC, with a 9 MiB per-item limit. The Adapter limits decoded batch staging to 64 MiB. Public MCP results never expose those bodies or source fingerprints.
4. The Adapter rechecks RAW PNG/JPEG/GIF/WebP magic bytes, checks RENDERED format, extension, and payload size, then reads raster pixel dimensions from final bytes. SVG uses root width/height or `viewBox`. Missing valid intrinsic dimensions reject the whole batch. Resolved output paths must be unique.
5. After every source, format, path, and overwrite condition passes, the Adapter writes all content into a transient session staging directory, rechecks targets for concurrent changes, and publishes the complete files as one recoverable batch. A failure restores backed-up targets and does not leave a partial project update.
6. Identical content at the same path returns `REUSED`; different content returns `EXPORT_TARGET_CONFLICT` by default. Explicit overwrite requires the existing SHA-256 and rechecks it immediately before commit.
7. Binding must happen before any export write. The same canonical root is idempotent, and a session cannot switch to another root. An unbound request fails with `EXPORT_ROOT_UNBOUND`; success returns ordered `{path,status,mimeType,width,height,dimensionUnit}` entries without file digests.

## Semantic snapshot lifecycle

1. The plugin fingerprints the complete requested root, then emits a stable flat `outline.jsonl`.
   `IMPLEMENTATION` also emits non-nested `facts.jsonl`; `focusNodeIds` limits detailed facts only.
2. It fingerprints the source again after serialization. Source drift returns
   `SEMANTIC_SOURCE_CHANGED`; a body above 12 MiB returns `PAYLOAD_TOO_LARGE`. Neither case writes files.
3. The Adapter derives a scope ID from a short node-ID hash and a request-variant hash below the
   source fingerprint. OUTLINE, focus sets, render choices, and budgets therefore never overwrite
   each other for the same design revision.
4. The shared safe writer commits JSONL and optional PNG first, then writes `manifest.json` as the
   completed-revision marker. Public MCP results contain the workspace-relative manifest path,
   source fingerprint, completeness, and optional truncation only.
5. The Agent may keep ordinary task notes when useful, referencing the manifest and recording code
   mappings, status, or unresolved differences. A `work-units/<scopeId>.json` file is not required,
   and the tool generates no subjective roles or page state machine.
6. Before completing a scope, the Agent calls `figma_check_semantic_scope` to compare the stored
   fingerprint with the current complete subtree without re-exporting bodies.

## Source immutability

Write handlers accept only nodes inside a root carrying the `figma-agent-mcp:proposal` plugin-data marker. Marker v3 adds `GENERATED`/`CLONED` origin, build state, and operation ID while marker v2 remains readable and writable. Requested targets describe intent; the Proposal root remains the write boundary and every cloned context node inside it is writable.

`figma_duplicate_as_proposal` accepts edit targets and resolves clone roots automatically. Flow children include their direct Auto Layout parent; ordinary leaves include their nearest structural container; Page and Section stop the search. Component Set variants and absolute Auto Layout children do not expand. The resolved scope is capped at 1000 scene nodes: an oversized inferred context falls back to the target with a warning, while an oversized target or aggregate request is rejected. Single roots are moved directly to the Page and multiple roots enter a transparent Page-level wrapper, so no Proposal remains in the original layout context. The public response maps only the requested edit targets to Proposal node IDs and resolution reasons; clone roots and the complete internal ID map remain private.

Before cloning, the plugin fingerprints each source root plus its immediate layout parent and sibling geometry. It verifies the same context after detaching the clones; any drift returns `SOURCE_CHANGED_DURING_CLONE` and rolls back. Cloned nodes are unlocked recursively, while source visibility, locks, hierarchy, and geometry are never changed. Mutations are serialized and split into a read-only preparation phase and a write phase. Preparation failures never touch undo history. Because empty `commitUndo()` calls and Page plugin data do not establish a Figma undo boundary, the write phase creates an invisible temporary node as its undo anchor. On failure, the bridge first commits the anchor and any partial writes as the current unit, then immediately triggers undo for that unit. Even a failure before the first business write can therefore roll back only the current mutation instead of the previous successful action. The anchor is removed before a successful commit and reverted with the mutation on failure. A later successful mutation cleans any invisible anchor left by a plugin crash. Public undo is intentionally absent because it could undo later manual edits.

Discard requires the last inspected Proposal fingerprint. A user edit after inspection produces `PROPOSAL_CHANGED` instead of deletion. Obtain a fresh complete-tree fingerprint with `figma_get_fingerprint`; compact `figma_get_node` results intentionally expose no fingerprint and are not a substitute.

## DesignPlan lifecycle

1. The agent inspects normalized trees/renders, calls `figma_list_fonts` and `figma_get_design_resources`, and optionally stages one Base64 asset at a time. The public asset handle contains only `assetId`, optional dimensions, and expiry; internal digests remain private.
2. For source-backed plans, the agent calls `figma_get_fingerprint` with the ordered source root IDs and copies both that order and the returned aggregate fingerprint into `source.rootNodeIds` and `source.fingerprint`.
3. `figma_validate_design_plan` checks the 1000-node/32-depth limits, globally unique refs, current-page sources/components, explicit fonts, staged-asset availability, style/variable compatibility, resource-name conflicts, and the optional source fingerprint. Its outer request may select up to 200 unique node or resource refs in `returnRefs`; these refs are cached with validation but do not participate in the plan digest.
4. A valid plan receives a single-use validation ID that expires after five minutes.
5. `figma_apply_design_plan` consumes the ID and repeats every mutable check before opening the write boundary. The public `refMap` is omitted by default and, when requested, contains only the selected node and resource refs.
6. The plugin creates a hidden marker-v3 root, creates or reuses namespaced local resources, builds the node tree, binds resources, commits operation markers, then reveals the Proposal.
7. Preparation failures create nothing. Write failures explicitly remove newly created resources and use the anchored rollback. The next write removes orphan `BUILDING` roots/resources after a plugin crash; resources associated with a committed Proposal are completed instead.

DesignPlan v1 supports Frame, Text, Rectangle, Ellipse, Line, Image, SVG, Clone, and Instance nodes; full geometry/visual/Auto Layout/text ranges; explicit font fallbacks; style and variable binding; and current-page component reuse. It never detaches instances or edits protected instance internals.

## Asset and resource boundaries

- Inputs are Base64 only. The MCP server never fetches URLs or reads caller-supplied local paths.
- Raster assets are magic-checked and limited to 8 MiB/4096 px. SVG is parsed, sanitized, limited to 2 MiB/16384 units, then reserialized before hashing.
- The plugin cache is 32 MiB with a ten-minute TTL and is cleared on disconnect. Internally, `assetId` remains paired with SHA-256 for integrity and deduplication; public results and DesignPlans use only `assetId`.
- Created resources use `Agent/<Proposal>/<name>`. Identical same-name resources are reused; different content returns `RESOURCE_CONFLICT`. Successful resources persist when a Proposal is discarded.
- Variables have one `Default` mode and only COLOR/FLOAT/STRING/BOOLEAN are created. Team Library APIs and import-by-key APIs are not called.

## Read limits

- Tree: default depth 2 / 200 nodes; hard limits 8 / 1000.
- Text: caller-bounded and explicitly marked when truncated.
- Render: maximum requested dimension 2048 px and raw PNG limit 9 MiB (keeps encoded RPC payload below the bridge limit).
- Persistent asset export: at most 32 items, 9 MiB per item, and 64 MiB decoded data per batch.
- Raw REST JSON: self-only by default, with explicit one-level children and projection of up to 32 unique top-level fields; the default limit is 256 KiB and the hard request limit is 2 MiB.
- Semantic RPC body: 12 MiB; a larger scope must be narrowed or split.
- Persistent asset and semantic writes require a bound workspace. Temporary tree/render storage retains its independent TTL and quota controls.

CSS from `getCSSAsync()` is labeled as a code-generation hint. Normalized snapshots remain the structural truth.
