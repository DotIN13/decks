# canvas/scripts

Build steps of the canvas package that run outside it.

## Owns

- `build-css.mjs`: writes `dist/surface.css`, the canvas surface sheet a host that bundles no CSS of
  its own links to (`@decks/canvas/surface.css`).

## May import

Node and the package's own `styles/`; nothing of the canvas's code.

## Rules

1. Its output is built, not kept: `dist/` is not in git.

## Check

```
npm run build:css -w @decks/canvas
```
