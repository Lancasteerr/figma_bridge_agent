# MCP tool reference

The MCP Server statically registers 25 tools. Apart from `figma_status`, names use
`figma_inspect_*`, `figma_frontend_*`, or `figma_design_*` to identify their domain. There is no
workflow activation, deprecated alias, or legacy-name parser.

| Domain   | Tool                                      | Purpose                                                             | Writes        |
| -------- | ----------------------------------------- | ------------------------------------------------------------------- | ------------- |
| Status   | `figma_status`                            | Current file, page, selection, and workspace state                  | No            |
| Inspect  | `figma_inspect_browse_nodes`              | Bounded navigation tree or temporary JSONL                          | No            |
| Inspect  | `figma_inspect_read_node_facts`           | Project one node into selected fact groups                          | No            |
| Inspect  | `figma_inspect_read_css_hint`             | Figma Inspect CSS hint                                              | No            |
| Inspect  | `figma_inspect_render_preview`            | Temporary PNG with a 30-minute TTL                                  | No            |
| Inspect  | `figma_inspect_read_raw_fields`           | Bounded `JSON_REST_V1` field projection                             | No            |
| Inspect  | `figma_inspect_read_design_resources`     | Current-page styles, variables, components, and instances           | No            |
| Inspect  | `figma_inspect_list_fonts`                | Available font styles and variable axes                             | No            |
| Frontend | `figma_frontend_bind_workspace`           | Bind the Agent's exact absolute workspace root                      | Local state   |
| Frontend | `figma_frontend_index_scope`              | Persist a structure-only index for a large scope                    | Local files   |
| Frontend | `figma_frontend_prepare_workunit`         | Persist immutable facts and create the implementation skeleton once | Local files   |
| Frontend | `figma_frontend_check_workunit_source`    | Return `FRESH/STALE` for one `workUnitId`                           | No            |
| Frontend | `figma_frontend_export_assets`            | Atomically export assets guarded by a workunit                      | Project files |
| Design   | `figma_design_read_source_fingerprint`    | Fingerprint ordered complete subtrees                               | No            |
| Design   | `figma_design_stage_asset`                | Stage a Base64 bitmap or SVG                                        | Plugin memory |
| Design   | `figma_design_duplicate_as_proposal`      | Create an isolated Proposal copy                                    | Figma copy    |
| Design   | `figma_design_create_frame`               | Create a Frame in a Proposal                                        | Figma copy    |
| Design   | `figma_design_reparent_nodes`             | Move Proposal nodes                                                 | Figma copy    |
| Design   | `figma_design_set_layout`                 | Set layout, sizing, and positioning                                 | Figma copy    |
| Design   | `figma_design_update_text`                | Update text after loading fonts                                     | Figma copy    |
| Design   | `figma_design_set_instance_properties`    | Set exposed Instance properties                                     | Figma copy    |
| Design   | `figma_design_create_component_from_node` | Convert a Frame to a Component                                      | Figma copy    |
| Design   | `figma_design_discard_proposal`           | Delete an unchanged Proposal                                        | Deletes copy  |
| Design   | `figma_design_validate_plan`              | Validate a complete DesignPlan                                      | No            |
| Design   | `figma_design_apply_plan`                 | Create a Proposal from a one-time validation ID                     | Figma copy    |

## Workspace binding

Every Adapter session begins `UNBOUND`. Before a persistent front-end write, the Agent obtains the
exact absolute workspace path from its execution environment and calls
`figma_frontend_bind_workspace` with the latest `workspace.sessionId`. Rebinding the same canonical
root is idempotent; switching roots returns `EXPORT_ROOT_CONFLICT`. Workunit, index, and project
asset writes return `EXPORT_ROOT_UNBOUND` while unbound. Temporary trees and previews remain usable.

## Inspect facts

`figma_inspect_read_node_facts.fields` accepts
`BOUNDS|LAYOUT|TEXT|APPEARANCE|ASSET_SOURCES|COMPONENT|DIRECT_CHILDREN` and excludes
`DIRECT_CHILDREN` by default. Implementation coordinates use `bounds.inParent`, `bounds.onPage`,
and `bounds.renderOnPage`. Navigation trees expose only `navigationBoundsInParent`, which is not an
implementation fact.

Preview results are `{localPath,pixelWidth,pixelHeight,expiresAt}`. Large trees may use temporary
JSONL. CSS is always a hint; raw fields are a fallback for one known gap.

## Workunits

Use `figma_frontend_index_scope` to decompose a large page; it persists structure only. Every
implementation range must call `figma_frontend_prepare_workunit`, which returns
`{workUnitId,workUnitPath,sourceFingerprint,evidenceComplete,requiresMappingReview,truncation?}`.

```text
.figma_bridge_agent/sessions/<sessionId>/work-units/<workUnitId>/
├─ source/current.json
├─ source/<sourceFingerprint>/<variant>/
│  ├─ manifest.json
│  ├─ outline.jsonl
│  ├─ facts.jsonl
│  └─ preview.png        # optional
└─ implementation.json
```

Source revisions are immutable. The tool creates `implementation.json` only once and never
overwrites it. Its fixed fields are `sourceFingerprint`, `fidelityPolicy`, `state`, `targetFiles`,
`mappings`, `assumptions`, and `unresolvedDifferences`. Map only components, selectors, assets, and
special geometry that actually produce code. Query facts by exact node ID or name with `rg`; never
load the complete JSONL body into conversation.

Refreshing the same fact scope keeps the `workUnitId`, writes a new source revision, and updates
`source/current.json`. An older implementation fingerprint sets `requiresMappingReview`; asset
export returns `WORKUNIT_SOURCE_STALE` until mappings are reviewed. The freshness tool accepts only
`workUnitId`.

## Asset export

`figma_frontend_export_assets` requires `workUnitId` and 1–32 items. The server resolves the root
and fingerprint from that workunit and checks the source before and after the batch; callers cannot
submit a `sourceGuard`. The batch stages at most 64 MiB and commits only after every format, path,
and overwrite condition passes.

- `RAW` supplies paint slot, index, and an extensionless `outputPathStem`.
- `RENDERED` supplies scale for PNG/JPG, or SVG without scale, plus a matching extension.
- Results are `{path,status,mimeType,intrinsicWidth,intrinsicHeight,dimensionUnit}`.

Raster dimensions come from final bytes. SVG uses root dimensions or `viewBox`. `OVERWRITE`
requires a checked `expectedExistingSha256`.

## Design boundary

Writes to existing artwork begin with `figma_design_duplicate_as_proposal`; subsequent mutations
chain `proposalFingerprint`. DesignPlan calls `figma_design_validate_plan` before consuming the
one-time ID with `figma_design_apply_plan`; the server still strictly parses the complete recursive
plan.
