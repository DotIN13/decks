# canvas/items

What sits on the canvas besides the drawing, and when each wakes: apps, documents, media, files.

## Owns

- `awake.ts`: which items are awake.
- `item-slot.tsx`, `item-surfaces.tsx`: an item's place and its surface.
- `MediaPlayer.tsx`, `missing.ts`, `natural-size.ts`, `news.ts`, `file-drop.ts`, `file-kinds.ts`.

## May import

The rest of `canvas/`, `pen/`, `ui/`, `engine/`, `protocol/`.

## Rules

1. An item asleep is its picture; only an awake item has a page.

## Check

```
node tools/check.mjs canvas
```
