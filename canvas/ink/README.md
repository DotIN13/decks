# canvas/ink

Pencil strokes: shaping a stroke as it grows, the ink layer, and the tray's keys.

## Owns

- `shaper.ts`, `index.ts`: strokes as geometry, also `@decks/canvas/ink`; beside them `outline.ts` (a stroke's path, thinned points, bounds), `hit.ts` (what a point or a loop touches) and `history.ts` (undo and redo).
- `InkLayer.tsx`: the glass over the canvas while the draw tool is on; `ink-gestures.ts`, what a pointer on it does; `live-ink.ts`, the stroke under the pen until the sheet draws it.
- `model.ts`, `ink.ts`, `ink-keys.ts`.

## May import

The rest of `canvas/`, `pen/`.

## Rules

1. A stroke is saved once, after the pen lifts.

## Check

```
node tools/check.mjs canvas
```
