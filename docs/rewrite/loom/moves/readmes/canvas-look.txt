# canvas/look

How things look: fonts and their coverage, icons, code colours, maths, media.

## Owns

- `font-files.ts`, `font-coverage.ts`, `icons.ts`, `icon-index.ts`, `highlight.ts`, `math.ts`, `media-look.ts`, `look.ts`.

## May import

The rest of `canvas/`, `pen/`.

## Rules

1. The page sets words as the engine does, so an opened card barely moves.

## Check

```
node tools/check.mjs canvas
```
