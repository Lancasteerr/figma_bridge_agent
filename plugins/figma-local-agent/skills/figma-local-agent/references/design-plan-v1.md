# DesignPlan v1

Read this reference only when constructing a declarative DesignPlan. For edits to existing artwork,
prefer `figma_duplicate_as_proposal`, including when the selected Page child is not a Frame.

## Root semantics

`plan.root` is the Frame that the bridge creates as the isolated Proposal and write boundary. It is
not the Figma Page and does not need to represent a complete screen. A small card, component draft,
or local layout is valid. DesignPlan v1 cannot create a Section, Instance, or primitive as the
Proposal root; create them below the Frame, or duplicate existing artwork instead.

| Field                      | Meaning                                                                        |
| -------------------------- | ------------------------------------------------------------------------------ |
| `geometry`                 | Node bounds and constraints. Required for created nodes; optional for `CLONE`. |
| `layout`                   | Auto Layout configuration on a `FRAME`.                                        |
| `placement`                | How a node participates in its parent, including `sizing` and positioning.     |
| `visual`                   | Paints, strokes, opacity, blend mode, radius, and effects.                     |
| `clipsContent`             | A `FRAME` field; never place it inside `visual`.                               |
| `text.font.requested`      | Required base font selection for `TEXT`.                                       |
| `sourceNodeId`             | Source of a `CLONE`.                                                           |
| `source: { mode, nodeId }` | Source of an `INSTANCE`.                                                       |

## Generated local Proposal

This plan creates a card-sized Proposal rather than a complete page.

```json
{
  "version": 1,
  "proposal": { "name": "Profile card proposal" },
  "root": {
    "kind": "FRAME",
    "ref": "proposal-root",
    "name": "Profile card proposal",
    "geometry": { "width": 360, "height": 180 },
    "layout": {
      "mode": "VERTICAL",
      "gap": 12,
      "padding": { "top": 24, "right": 24, "bottom": 24, "left": 24 },
      "primaryAxisAlign": "MIN",
      "counterAxisAlign": "MIN"
    },
    "clipsContent": true,
    "children": [
      {
        "kind": "TEXT",
        "ref": "title",
        "name": "Title",
        "geometry": { "width": 312, "height": 32 },
        "placement": {
          "sizing": { "horizontal": "FILL", "vertical": "HUG" },
          "positioning": "AUTO"
        },
        "text": {
          "characters": "Profile",
          "font": { "requested": { "family": "Inter", "style": "Bold" } },
          "fontSize": 24,
          "textAutoResize": "HEIGHT"
        }
      }
    ]
  }
}
```

## Source-backed Proposal

Collect every Clone or Instance source under the ordered `source.rootNodeIds`, call
`figma_get_fingerprint` with that exact order, then copy both the returned order and fingerprint into
the plan. A Clone source may be a supported non-Frame SceneNode, but it cannot be inside an Instance.

```json
{
  "version": 1,
  "source": {
    "rootNodeIds": ["42:10", "42:20"],
    "fingerprint": "0123456789abcdef"
  },
  "proposal": { "name": "Source-backed card proposal" },
  "root": {
    "kind": "FRAME",
    "ref": "proposal-root",
    "name": "Source-backed card proposal",
    "geometry": { "width": 720, "height": 240 },
    "children": [
      {
        "kind": "CLONE",
        "ref": "existing-badge",
        "name": "Existing badge",
        "sourceNodeId": "42:10",
        "geometry": { "x": 24, "y": 24, "width": 120, "height": 40 }
      },
      {
        "kind": "INSTANCE",
        "ref": "action-button",
        "name": "Action button",
        "geometry": { "x": 520, "y": 168, "width": 176, "height": 48 },
        "source": { "mode": "CREATE_INSTANCE", "nodeId": "42:20" },
        "properties": { "Label": "Follow", "Enabled": true }
      }
    ]
  }
}
```

`CREATE_INSTANCE` requires a current-page Component or an Instance with an accessible main
component. `CLONE_INSTANCE` requires a current-page Instance. Request exact fonts with
`figma_list_fonts` before validation and use resources or staged assets only when the plan needs
them.

Validate each complete candidate once. If validation reports a specific error, correct it and treat
the changed plan as a new candidate; do not probe the schema with repeated validation calls.
