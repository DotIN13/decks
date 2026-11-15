# canvas/cards

Cards: mounting a card's HTML and scripts, reading it, its pictures, its frame, and the card editor.

## Owns

- `card.ts`: `mountCard`, a card's module handed the card.
- `card-load.ts`, `card-reading.ts`, `card-snapshot.ts`, `card-surface.tsx`, `card-frame.ts`, `card-syntax.ts`, `markdown.ts`.
- `CardEditor.tsx`: editing a card's words in place.
- `runtime/`: what a card needs to run anywhere, and its `lib/` (vendored libraries copied in at install).

## May import

The rest of `canvas/`, `pen/`, `ui/`, `protocol/`.

## Rules

1. A card's styles stay inside it; its scripts get `card.root`, never `document`.
2. `runtime/lib/` holds only Decks's own files in git.

## Check

```
node tools/check.mjs canvas
```
