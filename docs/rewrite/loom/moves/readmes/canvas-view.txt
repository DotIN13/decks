# canvas/view

The canvas element: its layers in order, the items layer, the selection and its pills.

## Owns

- `CanvasView.tsx`: the canvas, composing camera, input, editor, items and ink.
- `items-layer.tsx`: where awake items are mounted.
- `selection.tsx`: the selection's outline and pills.

## May import

The rest of `canvas/`, `pen/`, `ui/`, `engine/`, `protocol/`.

## Rules

1. Markup and class names stay: the browser checks select by them.
2. A part is model, view and actions (the splits of step 5).

## Check

```
node tools/check.mjs canvas
```
