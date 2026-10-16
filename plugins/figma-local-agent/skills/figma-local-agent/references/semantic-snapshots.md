# Semantic snapshots

Read this reference only in `FRONTEND` when a large page/region would otherwise fill the
conversation, or when durable queryable evidence is useful. Small components normally need only
targeted tree and node reads.

Follow the single workspace-binding procedure in [SKILL.md](../SKILL.md) before the first persistent
write. Pass the latest `workspace.sessionId` as `expectedSessionId`.

## Scope and storage

Snapshots live below
`.figma_bridge_agent/sessions/<sessionId>/scopes/<scopeId>/<sourceFingerprint>/<variant>/`.
They are local evidence, not product source; do not copy their bodies into the conversation.

- `OUTLINE` maps a large bounded scope and intentionally has no `facts.jsonl`.
- `IMPLEMENTATION` contains detailed facts for its bounded root or `focusNodeIds`.
- A temporary tree JSONL is a 30-minute navigation artifact, not a durable snapshot or freshness
  record.

For one region, export it directly with `IMPLEMENTATION`. For a large page, export one `OUTLINE`,
choose task-shaped child scopes from the user goal and repository, then work through one bounded
`IMPLEMENTATION` scope at a time. There is no required page decomposition.

Read `manifest.json`, then query JSONL by exact node ID or name with `rg` or another line-oriented
search. Never load a complete `facts.jsonl` into model context. Narrow the root or
`focusNodeIds` when one record is too large.

`DEPTH_LIMIT`, `NODE_LIMIT`, or `BYTE_LIMIT` means the structural evidence is incomplete;
split or narrow before relying on it. `TEXT_LIMIT` keeps structural coverage but requires a
targeted export when omitted text matters.

## Notes and freshness

Keep ordinary task notes only when useful. A `work-units/<scopeId>.json` ledger is not required.
Notes may link the manifest, source fingerprint, target files, important node-to-code mappings,
assumptions, and unresolved differences; do not duplicate semantic records.

Before completing a scope whose decisions depend on a snapshot, call
`figma_check_semantic_scope`. `STALE` requires re-export and review of affected decisions.
`FRESH` confirms only that the Figma source is unchanged; it is not visual acceptance.
