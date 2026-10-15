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

## Confirm the static implementation boundary

Figma is static visual evidence. It can establish materialized layout, styling, text, assets,
clipping, and visible states, but it cannot establish product behavior. Before finalizing an
implementation plan, separate the inspected content into:

- the page, component, or region that is the implementation target;
- annotations, component state boards, and adjacent frames that are reference material only; and
- behavior that the static evidence cannot establish.

Inspect the target repository for existing routes, components, API clients, state conventions,
responsive rules, and scrolling conventions. Ask the user only about material behavior that
remains unresolved after that inspection. Do not repeat a question when the user's request already
sets the boundary, such as a request for a static or pixel-accurate reproduction.

Material unknowns include:

- the result of clicking, submitting, selecting, or switching a control;
- network requests, persistence, or other side effects;
- modal, drawer, pagination, and multi-state behavior;
- responsive breakpoints or content reordering;
- page versus inner-container scrolling, sticky or fixed regions, infinite loading, scroll
  restoration, scroll-linked animation, and custom scrollbar treatment; and
- required loading, empty, error, or disabled states.

Use the host's structured question UI when available and group related unknowns into no more than
three questions per round. Do not ask the user to decide colors, spacing, or other facts that the
design and repository can establish. Do not query prototype reactions to infer product behavior.

Treat Figma `clipsContent`, `overflowDirection`, and fixed-child facts only as static layout hints.
They do not determine the browser's scrolling contract. When scrolling materially affects the
implementation, confirm whether the page or an inner region scrolls, which regions remain fixed,
and whether pagination, infinite loading, restoration, animation, or custom scrollbars are
required.

Do not finalize the implementation plan until material unknowns are confirmed. If interaction is
unavailable or the user explicitly asks to continue, preserve semantic controls and basic keyboard
behavior but do not invent APIs, navigation destinations, persistence, mobile layouts, unseen
loading/error/empty states, inner scrolling, sticky or fixed positioning, infinite loading, scroll
restoration, scroll animation, or custom scrollbars. Use normal document flow; content taller than
the viewport may produce ordinary browser page scrolling. Record that as an engineering default,
not Figma evidence. Reproduce only visible clipping and record confirmed behavior, conservative
assumptions, and out-of-scope behavior separately.

## Gather implementation evidence

1. Follow [semantic snapshots](semantic-snapshots.md) for implementation evidence. Export a single
   component directly with `IMPLEMENTATION`; for a large region or page, inspect `OUTLINE` and then
   activate only one bounded `IMPLEMENTATION` scope at a time. Treat a render as appearance
   evidence, not a substitute for node structure. A render result is a 30-minute local PNG path;
   open it with the Agent's visual tool only when inspection is necessary and regenerate it after
   expiry.
2. Read only leaf nodes whose exact treatment affects the result, especially selected-state
   indicators, distinctive icons, text, image crops, masks, overlays, and effects. Also inspect any
   element that may be replaced by an existing project component or icon.
3. Use normalized snapshots as the structural source of truth. Call `figma_get_css` only when its
   Inspect output resolves a material front-end styling decision. Use a self-only, field-projected
   `figma_get_raw_node` result only for a known fact that normalized data still omits; do not fetch
   raw data speculatively or use it as the ordinary implementation source.
4. Record the relevant Figma fact and implementation decision for each material element in a
   lightweight work unit. Reference the source manifest instead of copying semantic records. If a
   fact cannot be established, preserve the uncertainty instead of inventing a visual value.

## Decide between code and assets

- Read [asset export](asset-export.md) whenever a material leaf may require a project file. That
  reference owns the code, `RAW`, and `RENDERED` decision and the delivery procedure.
- A familiar meaning does not make an icon visually simple. In high-fidelity mode, reuse a library
  icon only after verifying outline, fill versus stroke, stroke details, view box, internal spacing,
  and optical alignment. Otherwise export the exact icon node as `RENDERED` SVG.
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

High fidelity means evidence-based static visual equivalence in a controlled environment, not
guaranteed byte-identical pixels across Figma, browser, operating-system, or renderer versions. By
default, validate the initial `scrollTop = 0` state only. Do not claim that interaction, responsive,
or scrolling behavior was reproduced unless it was established separately and tested.
