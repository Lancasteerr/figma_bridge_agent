# MCP tool reference

[中文版](../zh-CN/tools.md) · [Documentation home](README.md)

The MCP Server registers 25 tools, but every MCP connection starts with only `figma_status` and `figma_activate_workflow`. Public results contain only fields needed by the Agent's next step. Plugin RPC payloads, caches, and persisted manifests may retain internal digests and accounting data, but those structures are not reused as tool results.

## Workflow activation

Call `figma_status` first, then call `figma_activate_workflow` once: use `INSPECT` to view, navigate, or explain a design; `FRONTEND` to implement UI or export project assets; and `DESIGN` to create or modify Figma content. The SDK refreshes the list through standard `notifications/tools/list_changed`, which the client must support.

Activation belongs only to the current connection. Repeating one workflow is idempotent; switching disables the previous workflow-specific tools. Cold start, `INSPECT`, `FRONTEND`, and `DESIGN` expose 2, 9, 13, and 21 tools respectively. There is no `FULL` mode; switch workflows between phases of a mixed task. Activation itself does not connect Figma, bind a workspace, modify files, or change a Proposal.

## Tool list

| Workflow | Group      | Tool                               | Purpose                                                                     | Writes to Figma        |
| -------- | ---------- | ---------------------------------- | --------------------------------------------------------------------------- | ---------------------- |
| Always   | Status     | `figma_status`                     | Return `{document,page,selection,workspace}`                                | No                     |
| Always   | Status     | `figma_activate_workflow`          | Switch the workflow-specific tools visible on this connection               | No                     |
| FRONTEND | Status     | `figma_bind_export_root`           | Bind the Agent task's absolute workspace root to this session               | No                     |
| All      | Read       | `figma_get_design_resources`       | Page through local styles, variables, and current-page components/Instances | No                     |
| All      | Read       | `figma_list_fonts`                 | Page by font family, styles, and optional variation axes                    | No                     |
| All      | Read       | `figma_get_raw_node`               | Return self-first, projectable `JSON_REST_V1`                               | No                     |
| All      | Read       | `figma_get_css`                    | Return a Figma Inspect CSS property map                                     | No                     |
| All      | Read       | `figma_get_node`                   | Return a projectable compact set of facts for one node                      | No                     |
| All      | Read       | `figma_get_tree`                   | Return a lightweight tree, truncation, or temporary JSONL                   | No                     |
| DESIGN   | Read       | `figma_get_fingerprint`            | Return an ordered complete-subtree `treeFingerprint`                        | No                     |
| FRONTEND | Semantic   | `figma_export_semantic_scope`      | Persist a bounded scope and return its manifest path                        | No; writes local files |
| FRONTEND | Semantic   | `figma_check_semantic_scope`       | Return `FRESH` or `STALE`                                                   | No                     |
| All      | Asset      | `figma_render_node`                | Create a temporary PNG that expires after 30 minutes                        | No                     |
| FRONTEND | Asset      | `figma_export_assets`              | Atomically write Image Paints or node renders                               | No; writes local files |
| DESIGN   | Asset      | `figma_stage_asset`                | Validate Base64 bitmap/SVG data and stage it in memory                      | No; memory only        |
| DESIGN   | Proposal   | `figma_duplicate_as_proposal`      | Clone targets and context into an isolated Proposal                         | Yes; copy only         |
| DESIGN   | Proposal   | `figma_create_frame`               | Create a Frame inside a Proposal                                            | Yes; Proposal only     |
| DESIGN   | Proposal   | `figma_reparent_nodes`             | Move nodes within one Proposal                                              | Yes; Proposal only     |
| DESIGN   | Proposal   | `figma_set_layout`                 | Write Auto Layout, sizing, and positioning                                  | Yes; Proposal only     |
| DESIGN   | Proposal   | `figma_create_component_from_node` | Convert a Proposal Frame to a Component                                     | Yes; Proposal only     |
| DESIGN   | Proposal   | `figma_set_instance_properties`    | Edit exposed Instance properties without detaching                          | Yes; Proposal only     |
| DESIGN   | Proposal   | `figma_update_text`                | Atomically update text after loading fonts                                  | Yes; Proposal only     |
| DESIGN   | Proposal   | `figma_discard_proposal`           | Delete a matching Bridge Proposal                                           | Yes; deletes Proposal  |
| DESIGN   | DesignPlan | `figma_validate_design_plan`       | Read-only validation with a five-minute, single-use ID                      | No                     |
| DESIGN   | DesignPlan | `figma_apply_design_plan`          | Atomically create a Proposal from a validation ID                           | Yes; new Proposal only |

`figma_get_selection` and `figma_get_variables` have been removed. Selection is part of `figma_status`; variables are part of `figma_get_design_resources`.

## Workspace and file boundary

Every Adapter session starts as:

```json
{ "state": "UNBOUND", "sessionId": "..." }
```

Before the first asset or semantic-snapshot write, obtain the exact absolute workspace path from the Agent task's own execution environment and call `figma_bind_export_root` with the current `sessionId`. Success changes the state to `{state:"BOUND",sessionId,rootPath}`. Rebinding the same canonical root is idempotent; switching roots returns `EXPORT_ROOT_CONFLICT`.

When unbound, `figma_export_assets` and `figma_export_semantic_scope` return `EXPORT_ROOT_UNBOUND`. No staging files are created, and the plugin is not asked to produce a large payload. Temporary tree JSONL and render PNG files use a separate temporary store and remain available while UNBOUND.

Export paths must be workspace-relative and cannot contain drive letters, UNC/absolute roots, NUL, empty segments, or `..`. `REUSE_OR_FAIL` reuses identical content and rejects different content with `EXPORT_TARGET_CONFLICT`. Use `OVERWRITE` only after reading the existing file locally and computing its digest, then pass that digest as `expectedExistingSha256`. Conflict errors and success results never return internal SHA values.

## Read and temporary results

- `figma_get_design_resources` returns `{resources,nextCursor?,componentScanComplete}`; VARIABLE entries may include `codeSyntax`.
- `figma_list_fonts` returns `{families:[{name,styles,variationAxes?}],nextCursor?}` and advances by family.
- `figma_get_raw_node` returns `{node}`. It defaults to `depth: 0` and removes `children`; `depth: 1` keeps one level only. `fields` projects at most 32 unique top-level fields while `id`, `name`, and `type` are always retained. Unknown fields are ignored, and only `depth` controls `children`. Projection and depth trimming precede the 256 KiB default / 2 MiB hard byte check; narrow fields or depth when the result is too large. `figma_get_css` returns `{properties}`.
- `figma_get_node.fields` accepts `GEOMETRY|LAYOUT|TEXT|VISUAL|ASSETS|COMPONENT|CHILDREN`. Name, type, and parent are always returned; direct-child summaries require an explicit request. Use `geometry.local` for layout inside the immediate parent, `geometry.absolute` for Figma Page positioning, and `absoluteRenderBounds` for visible ink including outer strokes and shadows. Results do not expose snapshot fingerprints. Figma clipping/overflow values are static layout facts, not browser scrolling contracts.
- `figma_get_tree` returns `{root,truncation?,artifact?}`. Nodes use local `bounds` and omit default hints. An artifact contains only `{localPath,expiresAt}`.
- `figma_render_node` returns `{localPath,width,height,expiresAt}`; width and height are actual pixels decoded from the final PNG bytes.

A temporary tree is a navigation artifact, not a durable semantic snapshot. Query a few records by node ID, name, or type instead of loading the full JSONL into context. Repeat the read after expiry.

## Asset inspection and export

`figma_get_node.assets` reports Image Paint slot/index/hash, original dimensions, scale/crop, filters, and visibility, plus export settings, vector, and mask facts. `figma_get_tree.assetHints` discovers candidates only and never replaces a targeted node read.

`figma_export_assets` accepts 1–32 items. Resolved destinations must be unique and total staged data cannot exceed 64 MiB. The batch is committed only after every source, format, path, and overwrite condition passes. Any failure returns one structured error without partially updating project files. Each item uses one of two modes:

- `RAW`: provide paint slot/index and an extensionless relative `outputPathStem`. The Server detects PNG/JPEG/GIF/WebP by magic bytes and appends the actual extension.
- `RENDERED`: provide a relative `outputPath` with a matching extension. PNG/JPG accept scale 1–4; SVG accepts no scale.

When assets come from a semantic snapshot, the batch may provide one `sourceGuard:{rootNodeId,expectedSourceFingerprint}`. Every item must be under that root and the same source fingerprint must match before and after the batch. Without a guard, the plugin still checks each source before and after its item export. Image hashes, node fingerprints, and per-item tree fingerprints are no longer inputs.

Success returns `{assets:[{path,status,mimeType,width,height,dimensionUnit}]}`, where status is `CREATED|REUSED|UPDATED`. RAW and rendered raster dimensions are actual pixels decoded from the final bytes. SVG uses root width/height or falls back to `viewBox`, with `FIGMA_UNIT`. Missing valid intrinsic dimensions reject the whole batch before any write. Source-node logical dimensions remain in `figma_get_node`; never rescale an exported SVG from an internal path's bounds.

`figma_stage_asset` returns `{assetId,width?,height?,expiresAt}`. IMAGE/SVG references inside a DesignPlan contain only `assetId`; SHA remains internal for cache deduplication and integrity checks.

Fingerprint roles are intentionally narrow: front-end snapshot and asset work uses one semantic
`sourceFingerprint`; `treeFingerprint` is reserved for DesignPlan sources and complete-tree Proposal
checks; Proposal mutations continue chaining `proposalFingerprint`. `figma_get_node` exposes no
fingerprint.

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

The public `plan` schema for `figma_validate_design_plan` is compact generic JSON so the recursive definition is not injected into the tool list. The server still parses it with the complete strict `DesignPlanSchema`. `returnRefs` belongs to the outer request, does not affect the plan digest, and accepts at most 200 unique node or resource refs. Unknown refs produce `INVALID + issues`; apply adds `refMap` only when validation requested it.

See the complete [DesignPlan v1 reference](../../plugins/figma-local-agent/skills/figma-local-agent/references/design-plan-v1.md).

## Recommended workflows

### Read or implement a design

1. Call `figma_status`, then activate `FRONTEND`; activate `INSPECT` instead for view-only explanation.
2. Use the selection to establish the target, navigate with a shallow tree, then read only necessary nodes, CSS, fonts, and resources.
3. Bind the Agent's actual workspace before any persistent semantic or asset write.
4. Refresh source facts and purpose-specific fingerprints before implementation; render again and perform task-appropriate validation before completion.

### Edit an existing design

1. Call `figma_status`, activate `DESIGN`, then read and render the source target.
2. Duplicate it into a Proposal and keep only the Proposal ID and requested-target mappings.
3. Chain every returned `proposalFingerprint` through subsequent mutations.
4. Re-read and render the Proposal for user review.

### Generate a design

1. Call `figma_status`, activate `DESIGN`, then read fonts, design resources, and source `treeFingerprint` only when needed.
2. Stage images/SVGs and reference them by `assetId` only.
3. Submit one complete plan; include only mappings actually needed after apply in `returnRefs`.
4. Apply immediately after VALID. Revalidate a complete candidate when the ID expires, is consumed, or dependencies change.
