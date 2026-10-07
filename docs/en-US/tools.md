# MCP tool reference

[中文版](../zh-CN/tools.md) · [Documentation home](README.md)

The MCP Server exposes a fixed set of 23 tools. “Writes to Figma” indicates whether a tool changes the current Figma document. Reads, exports, and in-memory asset staging do not modify the document.

## Status

| Tool           | Purpose                                                                              | Writes to Figma |
| -------------- | ------------------------------------------------------------------------------------ | --------------- |
| `figma_status` | Return the plugin connection, current file, page, selection, and Bridge capabilities | No              |

## Reads and discovery

| Tool                         | Purpose                                                                                            | Writes to Figma |
| ---------------------------- | -------------------------------------------------------------------------------------------------- | --------------- |
| `figma_get_design_resources` | Page through local styles and variables plus reusable components and Instances on the current page | No              |
| `figma_list_fonts`           | Page through fonts currently available to Figma, including variable-font axes                      | No              |
| `figma_get_raw_node`         | Read bounded `JSON_REST_V1` for unsupported or unnormalized debugging details                      | No              |
| `figma_get_variables`        | Page through local variables and their collections                                                 | No              |
| `figma_get_css`              | Return Figma Inspect CSS as a code-generation hint                                                 | No              |
| `figma_get_selection`        | Return shallow summaries for selected nodes on the current page                                    | No              |
| `figma_get_node`             | Return a normalized snapshot of one node and direct-child summaries                                | No              |
| `figma_get_tree`             | Return a normalized subtree bounded by depth, node count, and text length                          | No              |
| `figma_get_fingerprint`      | Calculate an ordered aggregate fingerprint of complete node subtrees                               | No              |

## Rendering and assets

| Tool                 | Purpose                                                                      | Writes to Figma |
| -------------------- | ---------------------------------------------------------------------------- | --------------- |
| `figma_render_node`  | Render a node as a bounded PNG for visual inspection                         | No              |
| `figma_export_asset` | Export a node to a temporary PNG or SVG path with a SHA-256 digest           | No              |
| `figma_stage_asset`  | Validate and stage Agent-provided Base64 bitmap or SVG data in plugin memory | No, memory only |

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

## Recommended call sequences

### Read a design

1. Call `figma_status` to confirm the plugin connection and inspect the current selection.
2. Use `figma_get_selection` to locate the target, then read the node, tree, CSS, fonts, and design resources as needed.
3. Use `figma_render_node` to verify the visual result. Export an asset only when a file is needed.

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
- Tools remain discoverable while the plugin is closed, but calls fail quickly with `PLUGIN_NOT_CONNECTED`.
