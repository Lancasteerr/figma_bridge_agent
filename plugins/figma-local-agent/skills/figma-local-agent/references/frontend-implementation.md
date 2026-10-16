# Front-end implementation

Read this reference after activating `FRONTEND`. It defines how static Figma evidence becomes a
front-end implementation and when high-fidelity work is complete.

## Set the boundary

Honor an explicit request for exact reproduction, adaptation, or an existing design system. If the
priority is unstated and materially changes the solution, ask; otherwise default to high fidelity
and state that assumption.

Figma establishes visible layout, text, styling, assets, clipping, and materialized states. It does
not establish navigation, network calls, persistence, responsive reordering, scrolling ownership,
or unseen loading/error/empty states. Inspect the repository for those contracts before asking the
user. If they remain unknown and the user asks to proceed, keep semantic controls and normal
document flow, but do not invent APIs, routes, persistence, breakpoints, sticky regions, inner
scrolling, or unseen states. `clipsContent`, overflow fields, and prototype reactions are not
browser behavior contracts.

Exclude annotations, state boards, and neighboring reference frames from the implementation target
unless the user includes them.

## Gather the smallest useful evidence

- For one component or bounded region, use `figma_get_tree`, targeted `figma_get_node` calls,
  and a render only when appearance must be checked.
- For a large page/region or durable evidence, read
  [semantic snapshots](semantic-snapshots.md); use an `OUTLINE` and then one bounded
  `IMPLEMENTATION` scope at a time.
- Inspect exact leaves whose treatment affects the result: selected-state indicators, distinctive
  icons, text, image crops, masks, transforms, overlays, effects, and candidates for an existing
  project component.
- Use normalized snapshots as structural truth. CSS is a hint; raw-node projection is a targeted
  fallback. Preserve uncertainty instead of inventing a visual value.

## Interpret geometry and exported size

| Decision | Field |
| --- | --- |
| Position and size inside the immediate parent | `geometry.local` |
| Position on the Figma Page | `geometry.absolute` |
| Visible ink including outer strokes and shadows | `absoluteRenderBounds` |
| Display size of an exported file | export result `width` / `height` |

Export dimensions describe the final file's intrinsic canvas: pixels for raster files and SVG root
dimensions (or its `viewBox` fallback) for SVG. Source-node logical dimensions remain available
from `figma_get_node`. Never scale an already exported SVG again from an internal path's bounds.

## Choose code or an asset

Read [asset export](asset-export.md) only when a material element may become a project file. Use
code for text, layout, interaction, and ordinary CSS shapes. In high-fidelity mode, replace an icon
with a library icon only after its silhouette, fill/stroke, stroke details, view box, spacing, and
optical alignment agree; otherwise export the exact node. Do not normalize unusual geometry or add
effects without Figma or user evidence.

In engineering-adaptation mode, repository components may take priority. Record material visible
deviations in the plan and final handoff.

## High-fidelity completion gate

Before claiming completion, check every relevant visible element in the target, including:

- lines, vectors, and icons;
- typography that changes the visible result;
- images with crop, mask, or transform;
- visible selected, hover, or other state;
- elements whose layout box differs from their rendered ink boundary.

Fix the viewport, device-pixel ratio, zoom, fonts, and page state. Compare a fresh Figma render with
the complete implementation state, then verify geometry and computed styles for position, size,
color, opacity, effects, icon silhouette, typography, crop/transform, clipping, and overflow.
Renderer antialiasing noise is tolerable only when geometry and computed values agree.

Whole-page similarity never overrides a failed local element. If any material difference remains,
report the affected element and cause; do not state that visual validation passed. A semantic
`FRESH` result means only that the Figma source did not change.

This is a documentation-level completion rule. Do not invent `FIDELITY_PASS`, a leaf-ledger
protocol, an automatic crop service, or another MCP acceptance tool. Ordinary task notes are
enough.
