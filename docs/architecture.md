# Architecture and safety model

[中文版](architecture.zh-CN.md)

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

`packages/protocol` owns transport-independent Zod schemas. Each MCP adapter owns one stdio session and its temporary files. The automatically managed Bridge Daemon owns the loopback listener and multiplexes any number of authenticated MCP adapters onto one plugin connection. Plugin UI owns plugin-side authentication and reconnect behavior. Plugin main is the only process allowed to hold Figma objects.

The first adapter starts the Daemon when needed. Closing one host only closes its adapter. The Daemon exits after both the last adapter and the plugin have been disconnected for 30 seconds.

## Trust boundaries

- The WebSocket server binds only to `127.0.0.1`, permits one authenticated plugin, and accepts multiple authenticated MCP adapters on a separate path.
- MCP adapters use an internal Daemon credential. Each plugin receives a separate X25519/HKDF-derived token after six-digit SAS confirmation, then uses fresh nonces plus role- and direction-specific HMAC-SHA-256 proofs. Credentials and proofs cannot be reused across roles.
- RPC envelopes and every UI/main message are schema-validated and size-limited.
- Adapter logs go to stderr. The detached Daemon writes a bounded `bridge.log` in the user configuration directory and retains one rotated file. Logs contain only request ID, RPC method, duration, and outcome; secrets, image base64, and raw node JSON are excluded.
- Exported files go to an isolated directory under `%TEMP%/figma-agent-mcp/<session>/`, have sanitized names and SHA-256 metadata, and are removed at shutdown. Startup removes sessions older than 24 hours.

## Source immutability

Write handlers accept only nodes inside a root carrying the `figma-agent-mcp:proposal` plugin-data marker. Marker v3 adds `GENERATED`/`CLONED` origin, build state, and operation ID while marker v2 remains readable and writable. Requested targets describe intent; the Proposal root remains the write boundary and every cloned context node inside it is writable.

`figma_duplicate_as_proposal` accepts edit targets and resolves clone roots automatically. Flow children include their direct Auto Layout parent; ordinary leaves include their nearest structural container; Page and Section stop the search. Component Set variants and absolute Auto Layout children do not expand. The resolved scope is capped at 1000 scene nodes: an oversized inferred context falls back to the target with a warning, while an oversized target or aggregate request is rejected. Single roots are moved directly to the Page and multiple roots enter a transparent Page-level wrapper, so no Proposal remains in the original layout context. The response returns clone roots, requested-target mappings, resolution reasons, warnings, and the complete original-to-clone ID map.

Before cloning, the plugin fingerprints each source root plus its immediate layout parent and sibling geometry. It verifies the same context after detaching the clones; any drift returns `SOURCE_CHANGED_DURING_CLONE` and rolls back. Cloned nodes are unlocked recursively, while source visibility, locks, hierarchy, and geometry are never changed. Mutations are serialized and split into a read-only preparation phase and a write phase. Preparation failures never touch undo history. Because empty `commitUndo()` calls and Page plugin data do not establish a Figma undo boundary, the write phase creates an invisible temporary node as its undo anchor. On failure, the bridge first commits the anchor and any partial writes as the current unit, then immediately triggers undo for that unit. Even a failure before the first business write can therefore roll back only the current mutation instead of the previous successful action. The anchor is removed before a successful commit and reverted with the mutation on failure. A later successful mutation cleans any invisible anchor left by a plugin crash. Public undo is intentionally absent because it could undo later manual edits.

Discard requires the last inspected Proposal fingerprint. A user edit after inspection produces `PROPOSAL_CHANGED` instead of deletion. Obtain a fresh complete-tree fingerprint with `figma_get_fingerprint`; the fingerprint embedded in a bounded node snapshot covers different data and is not a substitute.

## DesignPlan lifecycle

1. The agent inspects normalized trees/renders, calls `figma_list_fonts` and `figma_get_design_resources`, and optionally stages one Base64 asset at a time.
2. For source-backed plans, the agent calls `figma_get_fingerprint` with the ordered source root IDs and copies both that order and the returned aggregate fingerprint into `source.rootNodeIds` and `source.fingerprint`.
3. `figma_validate_design_plan` checks the 1000-node/32-depth limits, globally unique refs, current-page sources/components, explicit fonts, staged-asset digests, style/variable compatibility, resource-name conflicts, and the optional source fingerprint.
4. A valid plan receives a single-use validation ID that expires after five minutes.
5. `figma_apply_design_plan` consumes the ID and repeats every mutable check before opening the write boundary.
6. The plugin creates a hidden marker-v3 root, creates or reuses namespaced local resources, builds the node tree, binds resources, commits operation markers, then reveals the Proposal.
7. Preparation failures create nothing. Write failures explicitly remove newly created resources and use the anchored rollback. The next write removes orphan `BUILDING` roots/resources after a plugin crash; resources associated with a committed Proposal are completed instead.

DesignPlan v1 supports Frame, Text, Rectangle, Ellipse, Line, Image, SVG, Clone, and Instance nodes; full geometry/visual/Auto Layout/text ranges; explicit font fallbacks; style and variable binding; and current-page component reuse. It never detaches instances or edits protected instance internals.

## Asset and resource boundaries

- Inputs are Base64 only. The MCP server never fetches URLs or reads caller-supplied local paths.
- Raster assets are magic-checked and limited to 8 MiB/4096 px. SVG is parsed, sanitized, limited to 2 MiB/16384 units, then reserialized before hashing.
- The plugin cache is 32 MiB with a ten-minute TTL and is cleared on disconnect. `assetId` is always paired with SHA-256.
- Created resources use `Agent/<Proposal>/<name>`. Identical same-name resources are reused; different content returns `RESOURCE_CONFLICT`. Successful resources persist when a Proposal is discarded.
- Variables have one `Default` mode and only COLOR/FLOAT/STRING/BOOLEAN are created. Team Library APIs and import-by-key APIs are not called.

## Read limits

- Tree: default depth 2 / 200 nodes; hard limits 8 / 1000.
- Text: caller-bounded and explicitly marked when truncated.
- Render: maximum requested dimension 2048 px and raw PNG limit 9 MiB (keeps encoded RPC payload below the bridge limit).
- Raw REST JSON: default 2 MiB, hard request limit 8 MiB.
- Temporary assets: 256 MiB per server session.

CSS from `getCSSAsync()` is labeled as a code-generation hint. Normalized snapshots remain the structural truth.
