# canvas

The canvas page, a library: the canvas element, its camera, the TypeScript editor, cards,
documents, ink, the engine's page side, and the frame that holds it all. Today's `packages/canvas`,
moved with `src/` flattened; card-host, ink and docs' page half join it in later steps.

## Owns

- `index.ts`: the entry, `@decks/canvas`; `public/` holds its other doors (camera, tools, host,
  comments).
- `stage/`, `camera/`, `edit/`, `editor.tsx`: the canvas element, where it looks, the editor.
- `items/`, `cards/`, `model/`, `ink/`, `look/`, `render/`, `ui/`, `frame/`, `host.ts`.
- `styles/`: the canvas surface sheets, in `@layer decks.surface`.

## May import

`protocol/`, `pen/`, `ui/`, `engine/`. Until step 4a of `docs/rewrite/loom/map.md` ends, also
today's `packages/protocol`, `packages/api` and `packages/hub` (DESIGN.md section 11).

## Rules

1. Behaviour, markup and class names stay: the browser checks, Studio and cards select by them.
2. The eight `stage` class names keep their word; every other use is renamed.
3. A part of the page is three files: model, view, actions.

## Check

```
node tools/check.mjs canvas
node tools/check.mjs harness
```
