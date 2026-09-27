# Architecture and safety model

[中文版](architecture.zh-CN.md)

## Process boundary

```text
MCP hosts (Codex / Claude Code / Cursor)
  ↕ independent stdio sessions (stdout is MCP only)
per-session MCP adapters
  ↕ authenticated ws://127.0.0.1:3900/mcp
single Bridge Daemon
  ↕ authenticated ws://127.0.0.1:3900/
Figma plugin UI
  ↕ validated postMessage
Figma plugin main
  ↕ Figma Plugin API
current Design page
```

`packages/protocol` owns transport-independent Zod schemas. Each MCP adapter owns one stdio session and its temporary files. The automatically managed Bridge Daemon owns the loopback listener and multiplexes any number of authenticated MCP adapters onto one plugin connection. Plugin UI owns plugin-side authentication and reconnect behavior. Plugin main is the only process allowed to hold Figma objects.

The first adapter starts the Daemon when needed. Closing one host only closes its adapter. The Daemon exits after both the last adapter and the plugin have been disconnected for 30 seconds.

## Trust boundaries

- The WebSocket server binds only to `127.0.0.1`, permits one authenticated plugin, and accepts multiple authenticated MCP adapters on a separate path.
- Plugin and MCP-client pairing use fresh nonces plus role- and direction-specific HMAC-SHA-256 proofs. Proofs cannot be replayed across roles, and the secret is never sent over the socket.
- RPC envelopes and every UI/main message are schema-validated and size-limited.
- Adapter logs go to stderr. The detached Daemon writes a bounded `bridge.log` in the user configuration directory and retains one rotated file. Logs contain only request ID, RPC method, duration, and outcome; secrets, image base64, and raw node JSON are excluded.
- Exported files go to an isolated directory under `%TEMP%/figma-agent-mcp/<session>/`, have sanitized names and SHA-256 metadata, and are removed at shutdown. Startup removes sessions older than 24 hours.

## Source immutability

Write handlers accept only nodes inside a root carrying the `figma-agent-mcp:proposal` plugin-data marker. The marker contains its schema version, source node IDs, and creation time, so it survives plugin restarts.

`figma_duplicate_as_proposal` clones a single subtree or puts multiple clones in a transparent wrapper and returns the complete original-to-clone ID map. Mutations are serialized. An immediate partial failure is rolled back inside the same mutation boundary; public undo is intentionally absent because it could undo later manual edits.

Discard requires the last inspected Proposal fingerprint. A user edit after inspection produces `PROPOSAL_CHANGED` instead of deletion.

## LayoutPlan lifecycle

1. The agent reads normalized snapshots, bounded trees, and an optional render.
2. `figma_validate_layout_plan` checks current-page membership, source-root separation, unique references, instance boundaries, complete coverage, and current source fingerprint.
3. A valid plan receives a single-use validation ID that expires after five minutes.
4. `figma_apply_layout_plan` consumes the ID and recomputes the source fingerprint.
5. The plugin clones source nodes, hides the temporary Proposal, constructs nested Frames from leaves to root, applies Auto Layout, places the result beside the source, marks it, and reveals it.
6. Any failure removes the temporary root and triggers the internal mutation rollback boundary.

The v1 schema permits horizontal/vertical Auto Layout, sizing, alignment, and absolute overlays. It rejects GRID, WRAP, detach, duplicate references, ancestor/descendant double references, and omissions in an existing container.

## Read limits

- Tree: default depth 2 / 200 nodes; hard limits 8 / 1000.
- Text: caller-bounded and explicitly marked when truncated.
- Render: maximum requested dimension 2048 px and raw PNG limit 9 MiB (keeps encoded RPC payload below the bridge limit).
- Raw REST JSON: default 2 MiB, hard request limit 8 MiB.
- Temporary assets: 256 MiB per server session.

CSS from `getCSSAsync()` is labeled as a code-generation hint. Normalized snapshots remain the structural truth.
