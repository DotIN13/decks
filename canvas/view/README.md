# canvas/view

The canvas element: its layers in order, the items layer, the selection and its pills.

## Owns

- `CanvasView.tsx`: the canvas, composing camera, input, editor, items and ink; its component makes each part
  in order, as module functions given what they read.
- `canvas-camera.ts`: where the world is placed, the camera controller, and the scroll kept with it.
- `canvas-editor.ts`: the editor's host on this page: its effects, the pointer's side, the editor.
- `canvas-markup.tsx`: the world with its slots, canvas and overlay, and the chrome held to the window.
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
