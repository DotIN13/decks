# engine

The drawing engine, in Rust: built to WebAssembly for the page and its render worker (`crates/web`),
to a native picture maker for the server (`crates/shot`), and for Metal on the iPad
(`crates/apple`, Anvil's). Today's `packages/stage`, moved; the package is `@decks/engine`.

## Owns

- `crates/`: doc, scene, text, paint, gpu, render, web, shot, apple.
- `build-web.sh`: builds `pkg/` (WebGPU) and `pkg-gl/` (WebGPU or WebGL 2). Built, not kept.
- `fetch-fonts.mjs`, `fonts/`: the fonts it draws with, fetched, not kept.
- `demo/`: a page that draws a drawing with the engine alone.

## May import

`protocol/` at most. The crates import only crates.

## Rules

1. Nothing built is in git: `pkg/`, `pkg-gl/`, `target/` and the fonts come from the build.
2. The crates keep the word `stage` in their own names (`stage_web`, `stage-shot`).
3. A picture is the same on every backend within one level, checked by the goldens.

## Check

```
node tools/heavy.mjs --wait -- npm run build:wasm -w @decks/engine
node tools/heavy.mjs --wait -- cargo test --manifest-path engine/Cargo.toml
```
