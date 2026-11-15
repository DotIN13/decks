# canvas/render

The engine's page side: the engine on the page, its render worker, backends and pictures.

## Owns

- `engine.ts`: the Rust page engine and its worker, driven from TypeScript.
- `render.worker.ts`, `backends/`, `device.ts`, `picture-ladder.ts`, `spatial.ts`, `measure.ts`, `reader.ts`, `recovery.ts`, `types.ts`.

## May import

The rest of `canvas/`, `engine/`, `pen/`.

## Rules

1. A lost GPU or a thrown frame restarts the engine; it never freezes the canvas.

## Check

```
node tools/check.mjs canvas
```
