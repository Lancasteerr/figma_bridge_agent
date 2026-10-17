# Front-end implementation

This reference owns fidelity, runtime-behavior boundaries, evidence decisions, and completion for
front-end code. Read [workunits](workunits.md) before writing visual implementation code.

## Choose the fidelity policy

- `EXACT` prioritizes visible equivalence to the materialized Figma state.
- `BALANCED` prioritizes repository components, its design system, and maintainability while
  recording material visible differences.

Honor an explicit request for exact reproduction, adaptation, or an existing design system. If an
unstated choice would materially change the solution, ask before finalizing the implementation
plan. Otherwise default to `EXACT` and record the assumption in `implementation.json`.

## Confirm the static implementation boundary

Figma is static visual evidence. It can establish materialized layout, styling, text, assets,
clipping, and visible states, but it cannot establish product behavior. Separate the requested
implementation target from annotations, component state boards, and adjacent reference frames.

Before finalizing the implementation plan, inspect the request and repository for existing routes,
components, API clients, state conventions, responsive rules, and scrolling conventions. Ask the
user only about material behavior that remains unresolved. Do not repeat a question when the
request or repository already establishes the contract.

Material unknowns include:

- the result of clicking, submitting, selecting, or switching a control;
- network requests, persistence, and other side effects;
- modal, drawer, pagination, and multi-state behavior;
- responsive breakpoints and content reordering;
- page versus inner-container scrolling and sticky or fixed regions;
- image or component lazy loading, infinite loading, and scroll restoration;
- scroll-triggered or scroll-linked animation and custom scrollbar treatment; and
- required loading, empty, error, disabled, or other unseen states.

Use the host's structured question UI when available and group related unknowns into no more than
three questions per round. Figma `clipsContent`, overflow fields, fixed-child fields, and prototype
reactions may help frame a question, but they are not browser behavior contracts.

If the user does not answer and explicitly asks to continue, preserve semantic controls and basic
keyboard behavior, use normal document flow, and do not add APIs, navigation destinations,
persistence, mobile reordering, inner scrolling, sticky or fixed positioning, lazy or infinite
loading, scroll restoration, scroll animation, or custom scrollbars. Record these conservative
defaults in `assumptions`. Set the workunit to `BLOCKED` when the requested behavior cannot be
implemented safely without the missing decision.

## Gather bounded evidence

- Use the current prepared workunit described in [workunits](workunits.md); do not implement
  directly from a navigation tree or preview.
- Inspect exact nodes whose treatment affects the result, especially selected-state indicators,
  distinctive icons, text, image crops, masks, transforms, overlays, effects, and candidates for
  an existing project component.
- Use normalized facts as structural truth. CSS is a hint and raw fields are a targeted fallback.
  Preserve uncertainty instead of inventing a visual value.

## Interpret public fields

| Decision                                        | Field                                |
| ----------------------------------------------- | ------------------------------------ |
| Position and size inside the immediate parent   | `bounds.inParent`                    |
| Position on the Figma Page                      | `bounds.onPage`                      |
| Visible ink including outer strokes and shadows | `bounds.renderOnPage`                |
| Navigation-only tree boundary                   | `navigationBoundsInParent`           |
| Temporary preview pixels                        | `pixelWidth` / `pixelHeight`         |
| Exported file canvas                            | `intrinsicWidth` / `intrinsicHeight` |

Do not use navigation bounds as implementation facts. Export dimensions describe the final file's
intrinsic canvas; do not rescale an SVG from an internal path's bounds.

## Choose code or an asset

Read [asset export](asset-export.md) whenever a material element may become a project file. That
reference owns repository reuse and the code, `RAW`, or `RENDERED` decision. Record material
adaptation differences in `unresolvedDifferences`.

## Completion gate

Call `figma_frontend_check_workunit_source` with only `workUnitId`. A `FRESH` result proves only
that the source used by `implementation.json` is unchanged. Confirm its fingerprint matches
`source/current.json` before visual acceptance.

Fix the target frame or browser viewport, device-pixel ratio, zoom, fonts, data state, and scroll
position. Unless scrolling was separately established and tested, validate only the initial
`scrollTop = 0` state. Capture the complete implementation state and obtain a fresh Figma preview
of the same scope.

Compare both images and verify numeric geometry and computed styles for position, size, color,
opacity, effects, icon silhouette, typography, image crop and transform, clipping, and overflow.
Renderer antialiasing noise is tolerable only when geometry and computed values agree. Correct
material differences and repeat the comparison; whole-page similarity never overrides a failed
local element.

Resolve or explicitly report every difference. A `COMPLETE` workunit with non-empty
`unresolvedDifferences` means the scope was delivered with disclosed differences; do not claim
unqualified high-fidelity validation. Do not claim that interaction, responsive, or scrolling
behavior was reproduced unless it was established separately and tested.

Only then set `state` to `COMPLETE`. Do not invent a model-level fidelity evaluator, leaf-risk
classifier, pixel-diff service, or another MCP acceptance tool.
