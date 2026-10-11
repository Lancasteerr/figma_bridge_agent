# Front-end implementation workflow

Use this reference when implementing a web page, application screen, or reusable UI component from
the current Figma document. It supplements the read and asset-export workflows; it does not change
the user's requested framework, repository conventions, or product scope.

## Choose the fidelity policy

When the request does not already establish a fidelity priority, ask the user to choose before the
implementation plan is finalized:

- **High-fidelity reproduction:** preserve the visible design and use Figma evidence for material
  implementation choices.
- **Engineering adaptation:** prefer the target project's design system, component library, and
  maintainability even when they introduce visible differences.

Do not repeat this question when terms such as pixel-accurate, exact reproduction, adapt, redesign,
or use the existing design system already answer it. If interactive clarification is unavailable or
the user asks to continue without choosing, use high fidelity and state the assumption.

## Gather implementation evidence

1. Follow [semantic snapshots](semantic-snapshots.md) when durable evidence is useful. Export a
   single component directly; for a large region or page, inspect `OUTLINE` before choosing bounded
   implementation scopes. Treat an optional render as appearance evidence, not a substitute for
   node structure.
2. Read only leaf nodes whose exact treatment affects the result, especially selected-state
   indicators, distinctive icons, text, image crops, masks, overlays, and effects. Also inspect any
   element that may be replaced by an existing project component or icon.
3. Use normalized snapshots as the structural source of truth. Call `figma_get_css` when its Inspect
   output can clarify front-end styling. Use bounded `figma_get_raw_node` only for a material detail
   that remains unavailable; do not fetch raw data speculatively.
4. Record the relevant Figma fact and implementation decision for each material element in a
   lightweight work unit. Reference the source manifest instead of copying semantic records. If a
   fact cannot be established, preserve the uncertainty instead of inventing a visual value.

## Decide between code and assets

- Implement text, layout, interaction, and genuinely equivalent primitives in code.
- A familiar meaning does not make an icon visually simple. In high-fidelity mode, reuse a library
  icon only after verifying outline, fill versus stroke, stroke details, view box, internal spacing,
  and optical alignment. Otherwise export the exact icon node as `RENDERED` SVG.
- Use `RAW` Image Paint bytes when CSS can faithfully reproduce the recorded transform, scale mode,
  crop, radius, opacity, and ordinary filters. Use `RENDERED` when masks, vectors, or compositing
  must be baked to preserve appearance. Follow [asset export](asset-export.md) for delivery and
  freshness checks.
- Do not add blur, shadow, letter spacing, gradients, or other visual treatment without Figma or
  explicit user evidence. Do not silently normalize unusual geometry into a conventional UI shape.
- In engineering-adaptation mode, existing components and icon libraries may take priority. List
  each material visible deviation in the plan and repeat the final deviations in the handoff.

## Validate before completion

1. Load the intended fonts and fix the browser viewport, device-pixel ratio, zoom, and page state.
   Match the target frame dimensions and avoid scrollbar-induced viewport changes.
2. Capture the complete implementation state and obtain a fresh Figma render of the same scope.
3. Compare numeric geometry and computed styles alongside the images. Check position, size, color,
   opacity, effects, icon silhouette, typography, image transform/crop, clipping, and overflow.
4. Treat antialiasing and other small renderer-specific edge noise as tolerable only when geometry
   and computed values agree. Wrong shapes, colors, effects, crops, or layout are material failures.
5. Correct material differences and repeat the comparison. If a difference cannot be resolved,
   report it with its affected element and cause; never claim that visual validation passed.

High fidelity means evidence-based visual equivalence in a controlled environment, not guaranteed
byte-identical pixels across Figma, browser, operating-system, or renderer versions.
