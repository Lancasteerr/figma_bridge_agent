# MCP tool reference

[中文版](../zh-CN/tools.md) · [Documentation home](README.md)

The MCP Server exposes a fixed set of 24 tools. Public results contain only fields needed by the Agent's next step. Plugin RPC payloads, caches, and persisted manifests may retain internal digests and accounting data, but those structures are not reused as tool results.

## Tool list

| Group      | Tool                               | Purpose                                                                                 | Writes to Figma         |
| ---------- | ---------------------------------- | --------------------------------------------------------------------------------------- | ----------------------- |
| Status     | `figma_status`                     | Return `{document,page,selection,workspace}`                                            | No                      |
| Status     | `figma_bind_export_root`           | Bind the Agent task's absolute workspace root to this session                           | No                      |
| Read       | `figma_get_design_resources`       | Page through local styles, variables, and current-page components/Instances             | No                      |
| Read       | `figma_list_fonts`                 | Page by font family, with styles and optional variation axes                            | No                      |
| Read       | `figma_get_raw_node`               | Return self-first, projectable `JSON_REST_V1` as an object                              | No                      |
| Read       | `figma_get_css`                    | Return a Figma Inspect CSS property map                                                 | No                      |
| Read       | `figma_get_node`                   | Return a projectable compact set of facts for one node                                  | No                      |
| Read       | `figma_get_tree`                   | Return a lightweight navigation tree, optional truncation, and optional temporary JSONL | No                      |
| Read       | `figma_get_fingerprint`            | Return an ordered complete-subtree `treeFingerprint`                                    | No                      |
| Semantic   | `figma_export_semantic_scope`      | Persist a bounded scope under the workspace and return its relative manifest path       | No; writes local files  |
| Semantic   | `figma_check_semantic_scope`       | Return `FRESH` or `STALE`                                                               | No                      |
| Asset      | `figma_render_node`                | Create a temporary PNG that expires after 30 minutes                                    | No                      |
| Asset      | `figma_export_asset`               | Safely write an original Image Paint or node render under the workspace                 | No; writes a local file |
| Asset      | `figma_stage_asset`                | Validate Base64 bitmap/SVG data and stage it in plugin memory                           | No; memory only         |
| Proposal   | `figma_duplicate_as_proposal`      | Clone edit targets and required context into an isolated Proposal                       | Yes; copy only          |
| Proposal   | `figma_create_frame`               | Create a Frame inside a Proposal                                                        | Yes; Proposal only      |
| Proposal   | `figma_reparent_nodes`             | Move nodes within one Proposal                                                          | Yes; Proposal only      |
| Proposal   | `figma_set_layout`                 | Write Auto Layout, sizing, and positioning                                              | Yes; Proposal only      |
| Proposal   | `figma_create_component_from_node` | Convert a Proposal Frame to a Component                                                 | Yes; Proposal only      |
| Proposal   | `figma_set_instance_properties`    | Edit exposed Instance properties without detaching                                      | Yes; Proposal only      |
| Proposal   | `figma_update_text`                | Atomically update text after loading required fonts                                     | Yes; Proposal only      |
| Proposal   | `figma_discard_proposal`           | Delete a Bridge Proposal when its fingerprint matches                                   | Yes; deletes Proposal   |
| DesignPlan | `figma_validate_design_plan`       | Read-only validation with a five-minute, single-use ID                                  | No                      |
| DesignPlan | `figma_apply_design_plan`          | Atomically create a Proposal from a validation ID                                       | Yes; new Proposal only  |

`figma_get_selection` and `figma_get_variables` have been removed. Selection is part of `figma_status`; variables are part of `figma_get_design_resources`.

## Workspace and file boundary

Every Adapter session starts as:

```json
{ "state": "UNBOUND", "sessionId": "..." }
```

Before the first asset or semantic-snapshot write, obtain the exact absolute workspace path from the Agent task's own execution environment and call `figma_bind_export_root` with the current `sessionId`. Success changes the state to `{state:"BOUND",sessionId,rootPath}`. Rebinding the same canonical root is idempotent; switching roots returns `EXPORT_ROOT_CONFLICT`.

When unbound, `figma_export_asset` and `figma_export_semantic_scope` return `EXPORT_ROOT_UNBOUND`. No STAGED directory is created, and the plugin is not asked to produce a large payload. Temporary tree JSONL and render PNG files use a separate temporary store and remain available while UNBOUND.

Export paths must be workspace-relative and cannot contain drive letters, UNC/absolute roots, NUL, empty segments, or `..`. `REUSE_OR_FAIL` reuses identical content and rejects different content with `EXPORT_TARGET_CONFLICT`. Use `OVERWRITE` only after reading the existing file locally and computing its digest, then pass that digest as `expectedExistingSha256`. Conflict errors and success results never return internal SHA values.

## Read and temporary results

- `figma_get_design_resources` returns `{resources,nextCursor?,componentScanComplete}`; VARIABLE entries may include `codeSyntax`.
- `figma_list_fonts` returns `{families:[{name,styles,variationAxes?}],nextCursor?}` and advances by family.
- `figma_get_raw_node` returns `{node}`. It defaults to `depth: 0` and removes `children`; `depth: 1` keeps one level only. `fields` projects at most 32 unique top-level fields while `id`, `name`, and `type` are always retained. Unknown fields are ignored, and only `depth` controls `children`. Projection and depth trimming precede the 256 KiB default / 2 MiB hard byte check; narrow fields or depth when the result is too large. `figma_get_css` returns `{properties}`.
- `figma_get_node.fields` accepts `GEOMETRY|LAYOUT|TEXT|VISUAL|ASSETS|COMPONENT|CHILDREN`. Name, type, and parent are always returned. Every applicable group except `CHILDREN` is selected by default; direct-child summaries require an explicit request, and `figma_get_tree` remains the preferred navigation tool. The result does not echo the input/page ID or expose a snapshot fingerprint. Default booleans, zero rotation, empty collections, invalid mask shells, and duplicate render bounds are omitted. Figma clipping/overflow values are static layout facts, not browser scrolling contracts.
- `figma_get_tree` returns `{root,truncation?,artifact?}`. Nodes use local `bounds` and omit default hints. An artifact contains only `{localPath,expiresAt}`.
- `figma_render_node` returns `{localPath,width,height,expiresAt}`.

A temporary tree is a navigation artifact, not a durable semantic snapshot. Query a few records by node ID, name, or type instead of loading the full JSONL into context. Repeat the read after expiry.

## Asset inspection and export

`figma_get_node.assets` reports Image Paint slot/index/hash, original dimensions, scale/crop, filters, and visibility, plus export settings, vector, and mask facts. `figma_get_tree.assetHints` discovers candidates only and never replaces a targeted node read.

`figma_export_asset` has two mutually exclusive modes:

- `RAW`: provide paint slot/index, the current image hash, the node snapshot fingerprint, and an extensionless relative `outputPathStem`. The Server detects PNG/JPEG/GIF/WebP by magic bytes and appends the actual extension.
- `RENDERED`: obtain the node's complete `treeFingerprint`, then provide a relative `outputPath` with a matching extension. PNG/JPG accept scale 1–4; SVG accepts no scale.

Success returns only `{path,status}`, where status is `CREATED|REUSED|UPDATED`.

`figma_stage_asset` returns `{assetId,width?,height?,expiresAt}`. IMAGE/SVG references inside a DesignPlan contain only `assetId`; SHA remains internal for cache deduplication and integrity checks.

## Semantic snapshots

`figma_export_semantic_scope` writes under `.figma_bridge_agent/sessions/<sessionId>/scopes/` and returns `{manifestPath,sourceFingerprint,complete,truncation?}`. `manifestPath` is workspace-relative. The persisted manifest retains file SHA values and creation time; the public result does not.

The manifest uses `schemaVersion: 2`, `normalization: "COMPACT_V1"`, and `factsStatus`. `OUTLINE` provides hierarchy, records `factsStatus: "NOT_REQUESTED"`, and does not create an empty `facts.jsonl`. `IMPLEMENTATION` records `WRITTEN` and adds compact layout, text, visual, asset, and component facts. Read the manifest first, then query JSONL by exact node ID/name with `rg`. `figma_check_semantic_scope` returns only `{status}`.

## Proposal and DesignPlan result chains

- duplicate returns `{proposalRootId,targetMap,warnings?,proposalFingerprint}`; `targetMap` covers requested edit targets only.
- create frame returns `{nodeId,proposalFingerprint}`.
- reparent, layout, Instance-property, and text mutations return `{proposalFingerprint}`.
- component conversion returns `{componentId,newProposalRootId?,proposalFingerprint}`; the new root appears only when the root was replaced.
- successful discard returns `{}`.

Pass each new `proposalFingerprint` as the next operation's `expectedFingerprint`.

DesignPlan `returnRefs` belongs to the outer `figma_validate_design_plan` request, not the plan, and does not affect the plan digest. It accepts at most 200 unique node or resource refs. An unknown ref produces `INVALID + issues`; success produces `VALID + validationId/expiresAt/warnings?`. Apply normally returns `{proposalRootId,proposalFingerprint}` and adds a merged `refMap` only when validation requested `returnRefs`.

See the complete [DesignPlan v1 reference](../../plugins/figma-local-agent/skills/figma-local-agent/references/design-plan-v1.md).

## Recommended workflows

### Read or implement a design

1. Call `figma_status` and use its selection to establish the target.
2. Navigate with a shallow tree, then read only necessary nodes, CSS, fonts, and resources; render when useful.
3. Bind the Agent's actual workspace before any persistent semantic or asset write.
4. Refresh source facts and purpose-specific fingerprints before implementation; render again and perform task-appropriate validation before completion.

### Edit an existing design

1. Read and render the source target.
2. Duplicate it into a Proposal and keep only the Proposal ID and requested-target mappings.
3. Chain every returned `proposalFingerprint` through subsequent mutations.
4. Re-read and render the Proposal for user review.

### Generate a design

1. Read fonts, design resources, and source `treeFingerprint` only when needed.
2. Stage images/SVGs and reference them by `assetId` only.
3. Submit one complete plan; include only mappings actually needed after apply in `returnRefs`.
4. Apply immediately after VALID. Revalidate a complete candidate when the ID expires, is consumed, or dependencies change.
