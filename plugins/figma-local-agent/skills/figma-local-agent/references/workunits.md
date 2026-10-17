# Front-end workunits

A workunit is the only front-end implementation context. It keeps code mappings and implementation
state small while full Figma facts remain in local JSONL.

## Create the scope

1. Call `figma_status`, then `figma_frontend_bind_workspace` with the exact project root and latest
   session ID.
2. For a large page, call `figma_frontend_index_scope` first. Read the structure-only outline and
   choose a bounded root based on repository responsibility.
3. Call `figma_frontend_prepare_workunit` for every implementation range. `factNodeIds` limits
   detailed facts without changing the outline; omit it to include all nodes in the bounded range.
4. Keep only one workunit active in the task. Do not mix mappings or completion state across roots.

## Storage and ownership

Workunits live under:

`.figma_bridge_agent/sessions/<sessionId>/work-units/<workUnitId>/`

- `source/current.json` is the server-owned pointer to the current source revision.
- `source/<sourceFingerprint>/<variant>/` is immutable and contains `manifest.json`,
  `outline.jsonl`, `facts.jsonl`, and optional `preview.png`.
- `implementation.json` is created once by the tool and then owned by the Agent. The tool never
  overwrites it.

`workUnitId` is stable for the same root and sorted fact-node set. Refreshing writes a new immutable
source revision and updates `source/current.json`. If the implementation fingerprint is older,
review mappings and affected decisions before changing `implementation.json.sourceFingerprint`.

## Maintain implementation.json

Before writing corresponding visual code, record only mappings that produce code:

- component or selector implementations;
- exported resources;
- special geometry whose treatment is not obvious.

Each mapping is `nodeId -> [{path,symbolOrSelector}]`. Keep `targetFiles`, `assumptions`, and
`unresolvedDifferences` current. State progresses through `PLANNED`, `IMPLEMENTING`, `BLOCKED`, and
`COMPLETE`; it is not an automatic leaf checklist.

Read facts with `rg` by exact ID or name. Never inject the whole JSONL file into conversation.
`DEPTH_LIMIT`, `NODE_LIMIT`, `TEXT_LIMIT`, or `BYTE_LIMIT` means relevant evidence must be narrowed
or refreshed before relying on it.

Project asset export requires the same `workUnitId`. The server resolves the root and fingerprint;
the caller must not assemble a source guard. Export is rejected while the Agent-owned fingerprint
does not match `source/current.json`.
