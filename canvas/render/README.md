# canvas/render

The engine's page side: the engine on the page, its render worker, backends and pictures.

## Owns

- `engine.ts`: the Rust page engine and its worker, driven from TypeScript: the engine class,
  its state, and a one-line delegate per method. The methods' work is in five stories, module
  functions given the engine: `engine-life.ts` (opening, the worker's messages, failing and
  restarting), `engine-frame.ts` (the camera, glides, tiles, drawing a frame), `engine-doc.ts` (the
  drawing, its layout, cards), `engine-hits.ts` (what is under a point) and `engine-pictures.ts`
  (pictures and fonts).
- `render.worker.ts`, `backends/`, `device.ts`, `picture-ladder.ts`, `spatial.ts`, `measure.ts`, `reader.ts`, `recovery.ts`, `types.ts`.

## May import

The rest of `canvas/`, `engine/`, `pen/`.

## Rules

1. A lost GPU or a thrown frame restarts the engine; it never freezes the canvas.

## Check

```
node tools/check.mjs canvas
```
