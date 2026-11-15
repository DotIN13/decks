# engine/crates

The engine's Rust crates, one job each.

## Owns

- `doc`: the drawing as a tree, and its edits. `scene`: layout, arrows, the index for picking.
- `text`: words, cards and maths set as glyphs. `paint`: a scene into draw calls.
- `gpu`, `render`: draw calls onto WebGPU or WebGL 2. `web`: the WebAssembly bindings.
- `shot`: pictures on the server. `apple`: the engine for Metal (Anvil's).

## May import

Each other, downward: doc, scene, text, paint, gpu, render, then web, shot and apple on top.

## Rules

1. A crate never reaches up the list above.
2. Behaviour is held by each crate's tests and the goldens.

## Check

```
node tools/heavy.mjs --wait -- cargo test --manifest-path engine/Cargo.toml
```
