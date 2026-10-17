# Front-end workunits

A workunit is the only front-end implementation context. It keeps code mappings and implementation
state small while full Figma facts remain in local JSONL.

## Create the scope

After the connection and workspace-binding steps in [SKILL.md](../SKILL.md):

1. For a large page, call `figma_frontend_index_scope` first. Read the structure-only outline and
   choose a bounded root based on repository responsibility.
2. Call `figma_frontend_prepare_workunit` for every implementation range. `factNodeIds` limits
   detailed facts without changing the outline. Omitting it includes every traversed node that
   remains inside the requested depth, node, text, and byte limits.
3. Inspect `evidenceComplete`, `truncation`, and `requiresMappingReview` before relying on the
   source. Narrow incomplete evidence and review affected mappings after a source refresh.
4. Keep only one current workunit in task context. Do not mix mappings or completion state across
   roots; there is no server-side workunit activation state.

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
The `fidelityPolicy` input initializes a new implementation file only; for an existing workunit,
the Agent-owned `implementation.json` is authoritative.

## Maintain implementation.json

The file has the fixed fields `sourceFingerprint`, `fidelityPolicy`, `state`, `targetFiles`,
`mappings`, `assumptions`, and `unresolvedDifferences`. Before writing corresponding visual code,
record only mappings that produce code:

- component or selector implementations;
- exported resources;
- special geometry whose treatment is not obvious.

Each mapping is `nodeId -> [{path,symbolOrSelector}]`. Keep `targetFiles`, `assumptions`, and
`unresolvedDifferences` current. `PLANNED` means the bounded evidence and intended mappings are
ready, `IMPLEMENTING` means code is changing, `BLOCKED` means a required fact or decision is
missing, and `COMPLETE` means the requested scope and required checks are finished. The state is
not an automatic leaf checklist, and non-empty `unresolvedDifferences` prevents an unqualified
high-fidelity claim.

Read facts with `rg` by exact ID or name. Never inject the whole JSONL file into conversation.
`DEPTH_LIMIT`, `NODE_LIMIT`, `TEXT_LIMIT`, or `BYTE_LIMIT` means relevant evidence must be narrowed
or refreshed before relying on it.

Read [asset export](asset-export.md) when the current workunit needs a project asset.
