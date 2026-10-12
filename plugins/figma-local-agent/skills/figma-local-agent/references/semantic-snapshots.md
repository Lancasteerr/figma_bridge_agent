# Semantic snapshot workflow

Use semantic snapshots when implementing a node, component, region, or page from the current Figma
document and the structural evidence would otherwise occupy substantial conversation context. The
bridge persists objective Figma facts; it does not decide component roles, implementation
boundaries, or code mappings.

## Bind the session workspace

1. Call `figma_status` and record the current `assetExport.sessionId`.
2. Obtain the exact absolute `process.cwd()` from the Agent's local task execution environment.
3. Before any asset or semantic write, call `figma_bind_export_root` with that cwd and the recorded
   session ID. Asset and semantic writes share one immutable session binding.
4. Pass the same session ID as `expectedSessionId` to semantic tools. Never reuse an ID from a
   previous Adapter process.

A bound snapshot is stored below
`.figma_bridge_agent/sessions/<sessionId>/scopes/<scopeId>/<sourceFingerprint>/<variant>/`. The
variant keeps different profiles, focus sets, render choices, and budgets immutable even when the
Figma source fingerprint is unchanged. The cache root contains its own `.gitignore`; do not add
snapshot files to product source or copy their bodies into the conversation.

A temporary JSONL returned by `figma_get_tree` is only a 30-minute navigation artifact. It is not a
semantic snapshot, does not bind a workspace, and must not be used as durable implementation
evidence or freshness state.

## Choose the smallest task-shaped scope

For one node or component:

1. Export that node directly with `profile: "IMPLEMENTATION"`; do not create a page-level state
   machine or inspect unrelated page regions.
2. Use `focusNodeIds` when only a few nodes need detailed facts. The outline still describes the
   bounded scope, while `facts.jsonl` contains details only for the focus nodes.
3. Read `manifest.json`, then query JSONL by exact node ID or name with `rg` or an equivalent
   line-oriented search.

For a large region or page:

1. Export the requested root with `profile: "OUTLINE"`.
2. Inspect the outline and let the user goal plus repository structure determine useful child
   scopes. There is no fixed page decomposition.
3. Export and activate one bounded child scope at a time with `profile: "IMPLEMENTATION"`.
4. Leave completed scopes on disk and retain only their lightweight work-unit summaries while
   working on the next scope.

Never read an entire `facts.jsonl` into model context. Use `rg` with an exact node ID/name and a
small context window. If one matching line is still too large, re-export with a narrower root or
`focusNodeIds`. A snapshot with `complete: false` because of `DEPTH_LIMIT`, `NODE_LIMIT`, or
`BYTE_LIMIT` is not complete implementation evidence; split or narrow the scope before relying on
it. `TEXT_LIMIT` preserves structural completeness but requires a targeted re-export when omitted
text affects the implementation.

## Create a lightweight work unit

The bridge creates snapshots. The Agent creates
`.figma_bridge_agent/sessions/<sessionId>/work-units/<scopeId>.json` with ordinary local file tools.
It is a compact implementation ledger, not another semantic-tree copy. Keep only:

- the source `manifest.json` path and fingerprint;
- the requested scope and fidelity policy;
- target code files;
- key Figma node IDs mapped to code symbols or selectors;
- `planned`, `implementing`, `blocked`, or `complete` state;
- unresolved material differences.

Do not paste outline or facts records into the work unit. Update mappings and unresolved differences
as implementation decisions change.

## Freshness and completion

Before completing an implemented scope, call `figma_check_semantic_scope` with the manifest root
node ID and stored fingerprint. `STALE` requires a new export and review of affected decisions;
`FRESH` confirms only that the Figma source did not change. Perform the local component/page checks
required by the user's task, but do not invent an independent reviewer role or automatically expand
a component request into whole-page validation.
