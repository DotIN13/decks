# canvas/drawing

The drawing as the page holds it: what is drawn, its boxes, layers and comments.

## Owns

- `drawing.ts`: the drawing, its edits and what arrives from the server.
- `boxes.ts`, `bounds.ts`, `layers.ts`, `doc-index.ts`, `comment-text.ts`.

## May import

The rest of `canvas/`, `pen/`, `protocol/`.

## Rules

1. The drawing changes only by ops; an edit shows at once and the server confirms it.

## Check

```
node tools/check.mjs canvas
```
