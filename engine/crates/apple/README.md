# stage-apple

The drawing engine for Apple platforms: what `stage-web` is for the browser, for iOS, iPadOS and
macOS. The iPad app links it as `DecksEngine.xcframework` (built by `build-apple.sh` in the app's
repo) and calls it through the C interface in `include/decks_engine.h`.

## Owns

- `src/engine.rs`: one engine. The same `Page` and `Worker` the browser runs (`stage-web`'s
  `engine.rs`), on one Metal device, in one thread: the worker paints tiles, the page lays them out
  with the cards' pictures, and the frame is drawn into a Metal layer or a Metal texture.
- `src/gesture.rs`: a drag or a resize as the web shows it: lifted, previewed by the page alone,
  then put down. Nothing saved, nothing in undo, no tile painted again until the drop.
- `src/device.rs`: opening the Metal device, the host's layer as a surface, the host's textures.
- `src/ffi.rs`: the C interface, and nothing else.
- `include/decks_engine.h`: the C interface, written by hand, kept in step with `ffi.rs`.
- `tests/`: the six drawings in `tools/fixtures/drawings/`, laid out and drawn natively.
- `goldens/`: the six drawings as the browser's engine drew them (`tools/web-goldens.mjs` here).

## May import

The engine's own crates (`stage-web`'s `engine` and `wire`, `stage-doc`, `stage-scene`,
`stage-paint`, `stage-gpu`, `stage-text`), `wgpu` with its Metal backend, and `objc2-metal` only to
wrap the host's Metal objects. Nothing from the app, nothing that reaches a network or a disk.

## Rules

1. **No drawing logic of its own.** Layout, painting, tiling, batching and shaders are the crates
   the browser uses. This crate only moves a document, a camera, pictures and frames across the C
   interface and runs the loop the browser's script runs. A fix to how something looks is made in
   those crates, so web and iPad change together.
2. **The document comes as the server sends it.** The whole drawing as `.pen` text, then the
   server's edits (`stage.pen.delta` edits, JSON) as they arrive, or this session's own batches of
   changes (`wire.rs` JSON). Both the page and the worker get every one, in order.
3. **The camera is the browser's camera.** `x`, `y` the stage point at the view's top left corner,
   `zoom` points per stage unit, `scale` device pixels per point. Hit testing takes stage points.
4. **Pictures are handed in.** A card's picture (`card:<path>`) or an image fill (its `url`) comes
   as RGBA pixels or as a Metal texture made on the engine's own device. The engine never fetches.
   What it asked for and has not got is listed by `decks_engine_wanted`.
5. **Fonts are handed in.** The same files the web page loads, by the same family names.
6. **A frame is drawn where the host says.** Into the `CAMetalLayer` the host attached, or into an
   `MTLTexture` the host made on the engine's device (RGBA8, render target and shader read). The
   picture is premultiplied, on transparent, as the web canvas is: the host lays it over its paper.
7. **The C interface is small and stable.** An opaque handle, numbers, UTF-8 strings in, JSON
   strings out (freed with `decks_engine_free_string`), byte buffers with their length. A call that
   fails returns false or null and leaves the reason in `decks_engine_error`. No call panics across
   the boundary: a panic inside is caught and reported as an error.
8. **One thread.** An engine is used from one thread at a time; the host serialises its calls.
9. **Same picture as the web.** The six fixture drawings drawn here are held to the browser
   engine's own pictures of them: no channel more than 3 levels off on at least 99.5% of pixels,
   the rule `stage-backends.ts` holds the browser's backends to.
10. **Same layout as the fixtures.** Every item's box, parent and paint order match the fixture's
    `layout.json`, within half a unit, except a text item's own width and height, which come from
    real fonts here and from pen's estimate there; their position must still match.

## Check

- `cargo test -p stage-apple` (heavy: through `tools/heavy.mjs`). Needs the fonts
  (`npm run fonts -w packages/stage`); without them the drawings with words are skipped.
- `node packages/stage/crates/apple/tools/web-goldens.mjs` draws the goldens again in Chromium with
  the committed `pkg/` (heavy).
