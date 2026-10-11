# MCP tool reference

[中文版](../zh-CN/tools.md) · [Documentation home](README.md)

The MCP Server exposes a fixed set of 24 tools. “Writes to Figma” indicates whether a tool changes the current Figma document. Reads, exports, and in-memory asset staging do not modify the document.

## Status

| Tool                     | Purpose                                                                                     | Writes to Figma |
| ------------------------ | ------------------------------------------------------------------------------------------- | --------------- |
| `figma_status`           | Return connection, document context, capabilities, and this session's export-root status    | No              |
| `figma_bind_export_root` | Bind the Agent task execution environment's absolute cwd once as this session's export root | No              |

## Reads and discovery

| Tool                         | Purpose                                                                                            | Writes to Figma |
| ---------------------------- | -------------------------------------------------------------------------------------------------- | --------------- |
| `figma_get_design_resources` | Page through local styles and variables plus reusable components and Instances on the current page | No              |
| `figma_list_fonts`           | Page through fonts currently available to Figma, including variable-font axes                      | No              |
| `figma_get_raw_node`         | Read bounded `JSON_REST_V1` for unsupported or unnormalized debugging details                      | No              |
| `figma_get_variables`        | Page through local variables and their collections                                                 | No              |
| `figma_get_css`              | Return Figma Inspect CSS as a code-generation hint                                                 | No              |
| `figma_get_selection`        | Return shallow summaries for selected nodes on the current page                                    | No              |
| `figma_get_node`             | Return one normalized node snapshot, asset facts, and direct-child summaries                       | No              |
| `figma_get_tree`             | Return asset-aware subtrees bounded by depth, node count, and text length                          | No              |
| `figma_get_fingerprint`      | Calculate an ordered aggregate fingerprint of complete node subtrees                               | No              |

## Rendering and assets

| Tool                 | Purpose                                                                             | Writes to Figma         |
| -------------------- | ----------------------------------------------------------------------------------- | ----------------------- |
| `figma_render_node`  | Render a node as a bounded PNG for visual inspection                                | No                      |
| `figma_export_asset` | Extract an original Image Paint or render a node into a safe workspace/staging path | No; writes a local file |
| `figma_stage_asset`  | Validate and stage Agent-provided Base64 bitmap or SVG data in plugin memory        | No, memory only         |

## Proposal operations

| Tool                               | Purpose                                                               | Writes to Figma       |
| ---------------------------------- | --------------------------------------------------------------------- | --------------------- |
| `figma_duplicate_as_proposal`      | Clone edit targets and required context into an isolated Proposal     | Yes, new copy only    |
| `figma_create_frame`               | Create an ordinary Frame inside a Proposal                            | Yes, Proposal only    |
| `figma_reparent_nodes`             | Move nodes inside one Proposal with flow or absolute placement        | Yes, Proposal only    |
| `figma_set_layout`                 | Set Auto Layout, spacing, sizing, and positioning on Proposal nodes   | Yes, Proposal only    |
| `figma_create_component_from_node` | Convert a Frame inside a Proposal into a Component                    | Yes, Proposal only    |
| `figma_set_instance_properties`    | Edit exposed Instance properties without detaching the Instance       | Yes, Proposal only    |
| `figma_update_text`                | Atomically update Proposal text after preloading required fonts       | Yes, Proposal only    |
| `figma_discard_proposal`           | Delete an unchanged Bridge-created Proposal using a fingerprint check | Yes, deletes Proposal |

## DesignPlan

| Tool                         | Purpose                                                                         | Writes to Figma        |
| ---------------------------- | ------------------------------------------------------------------------------- | ---------------------- |
| `figma_validate_design_plan` | Read-only validation of a complete DesignPlan with a five-minute, single-use ID | No                     |
| `figma_apply_design_plan`    | Atomically create a complete Proposal with a valid validation ID                | Yes, new Proposal only |

For the DesignPlan v1 node structure and constraints, see the [DesignPlan v1 reference](../../plugins/figma-local-agent/skills/figma-local-agent/references/design-plan-v1.md). The Agent Plugin includes it automatically; direct MCP users should read the repository copy before constructing a plan.

## Asset inspection and export

The `assets` field from `figma_get_node` and `figma_get_tree` reports Figma facts only: Image Paint `FILLS`/`STROKES` positions, indices, hashes, original dimensions, scale/crop, filters, and visibility; node export settings; vector path/segment counts; and mask state. One tree read looks up each image hash's dimensions only once. Empty hashes, missing images, and query failures remain attached to their paint instead of failing the whole read. These asset properties participate in the node snapshot fingerprint.

`figma_export_asset` has two mutually exclusive modes:

- `RAW`: provide the node ID, exact paint slot/index, current image hash, current node snapshot fingerprint, and an extensionless workspace-relative `outputPathStem`. The plugin resolves and validates that paint again, then returns original bytes. The Server accepts PNG, JPEG, GIF, or WebP magic bytes and appends the actual extension. RAW does not apply crop, filters, masks, or transcoding.
- `RENDERED`: first call `figma_get_fingerprint({ nodeIds: [nodeId] })`, then provide that complete-subtree fingerprint and a workspace-relative `outputPath` with a matching extension. PNG/JPG accept scale 1–4; SVG accepts no scale. Any descendant change returns `ASSET_SOURCE_CHANGED` before a file is written.

Every MCP Adapter starts as `STAGED` with an independent session directory retained for 24 hours. Before the first implementation-phase export, the Agent obtains the exact absolute cwd from its own local task execution environment and calls `figma_bind_export_root` with the latest `sessionId`. The root must not be inferred from the plugin process, plugin cache, Git metadata, or user prose. A successful binding changes delivery to `WORKSPACE` and cannot be switched to another root during that session.

When Agent cwd discovery or binding is unavailable, the session remains `STAGED`. A `STAGED` result has `requiresCopy=true`: copy `absolutePath` to `projectRelativePath` and verify SHA-256. Generated code must never reference the staging path.

Paths must be relative and cannot contain drive letters, UNC/absolute roots, NUL, empty segments, or `..`. The default `REUSE_OR_FAIL` reuses identical content and rejects different content with `EXPORT_TARGET_CONFLICT`. `OVERWRITE` is accepted only with the SHA-256 of the existing file that the caller just inspected, and returns `UPDATED` after a checked replacement. Public results contain no Base64 or SVG body.

## Recommended call sequences

### Read a design

1. Call `figma_status` to confirm the plugin connection and inspect the current selection.
2. Use `figma_get_selection` to locate the target, then read the node, tree, CSS, fonts, and design resources as needed.
3. Use `figma_render_node` to verify visual evidence. During planning, record assets, source fingerprints, and relative destinations without calling the export tool.
4. During implementation, refresh status and sources, bind the Agent task cwd before the first export, export only the recorded set, and complete the `WORKSPACE`/`STAGED` delivery and hash verification.

### Edit an existing design

1. Read and render the source nodes to establish the target and expected result.
2. Call `figma_duplicate_as_proposal` to create an isolated copy.
3. Include the Proposal root ID in every later write, and pass each write result's new fingerprint as the next operation's `expectedFingerprint`.
4. Read and render the Proposal again for user review.
5. Call `figma_discard_proposal` only while the complete-tree fingerprint still matches.

### Generate a design from scratch

1. Read fonts, current-page resources, and the complete aggregate fingerprint of any source nodes.
2. Stage required images or SVGs as Base64 with `figma_stage_asset`.
3. Build one complete DesignPlan and call `figma_validate_design_plan` once.
4. Apply it immediately with `figma_apply_design_plan`. If the validation expires or a dependency changes, rebuild the complete candidate.
5. Read and render the final Proposal instead of probing write handlers to bypass validation.

## Key boundaries

- `figma_get_fingerprint` returns an ordered aggregate fingerprint of complete subtrees for source validation, Proposal concurrency checks, and safe discard.
- Fingerprints in bounded snapshots from `figma_get_node`, `figma_get_tree`, and similar reads cover different data and are not substitutes for the aggregate fingerprint.
- Write tools cannot change source nodes or cross a Bridge-marked Proposal root.
- Input assets cannot use URLs or local paths. Team Library is never queried, and Instances are never detached.
- Export paths are always relative to the session's staging root or explicit bound root. Binding never trusts the MCP process cwd and cannot change after the first export.
- Tools remain discoverable while the plugin is closed, but calls fail quickly with `PLUGIN_NOT_CONNECTED`.
