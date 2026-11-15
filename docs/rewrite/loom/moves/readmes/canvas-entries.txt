# canvas/entries

The package's doors beside `index.ts`: `@decks/canvas/camera`, `/tools`, `/host`, `/comments`.

## Owns

- `camera.ts`, `tools.ts`, `host.ts`, `comments.ts`: re-exports, nothing else.

## May import

The rest of `canvas/`.

## Rules

1. An entry only re-exports; code lives in its folder.
2. A name leaves an entry only when nothing outside imports it.

## Check

```
node tools/check.mjs canvas
```
