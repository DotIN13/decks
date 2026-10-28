# Known failures

What fails on studio-canvas after the tidy-up of 2026-10-28, and why. Each line is an app bug a check
found, not a check that is out of date; the check is left failing (or works around it, where it says
so) until the bug is fixed. Remove a line when its fix lands.

Last full run on this Mac: 65 checks, 970 assertions passed, 5 failed, in 3 checks.

## App bugs

- **A board page is measured 48 px short when its first block's top margin collapses through the
  body.** `documentHeight()` in `packages/canvas/src/extent.ts` reads `body.scrollHeight`, which leaves
  the collapsed margin out, so the page can scroll by that much and a wheel over the board's top edge
  scrolls the page instead of panning the canvas. Check: `camera.mjs`, "a scroll landing on a board's
  outline pans the canvas" (fixture `how-deep-is-the-deep-sea.html`, 1960 px tall in a 1912 px frame).
- **A finger dragging a selected drawn item pans the canvas instead of carrying the item.**
  `editor/dom/pointer.ts` calls `keepTouch` only when the press is not `touch` or `pan`, and a finger on
  an item decides `{ do: "touch", then: "drawing" }`, so the touch is never kept, `holdTouch` never
  cancels it, and the stage's native scroll (`touch-action: pan-x pan-y`) takes the finger.
  Check: `card-phone.mjs`, "a picture carried by a finger drops between two of the card's blocks".
- **The camera jumps back to the canvas's arrival view about 450 ms after a live board is dropped.**
  The arrival landing (`App.tsx`, `landOn` / `settle`, about l. 1132 to 1155) is not called off by the
  person's own camera moves and lands on a later frame of the deck, here the one the drop causes.
  Check: `drop-lands.mjs`, "a live board: … nor its page". Its WebKit setup ("a board on screen to pick
  up") is also flaky in a full parallel run.
- **Home and End typed in an open card scroll the whole stage on a Mac.** The stage scrolls natively,
  and `holdScrollKeys` in `Stage.tsx` lets the scroll keys through inside editables; the note editor
  handles Home and End itself, the card editor does not. Worked around in `card-editor.mjs`, which uses
  ⌘← instead.
- **The top bar's canvas chip is made again whenever a canvases frame arrives**, so an open canvas
  menu can vanish under the pointer. `apps/web/src/v3/TopBar.tsx` (about l. 110) calls
  `props.canvasMenu(...)` in a block that re-runs on each fresh `canvasMenu` from `App.tsx`. Worked
  around in `stages.mjs`, which presses the chip again.
- **After quick zooms, some glyphs are drawn from another glyph's place in the glyph texture**: 232
  of 51,030 in the Rust test `engine::glyph_overflow::zooming_chinese_text_in_and_out_never_draws_a_tile_with_another_glyph`
  (`packages/stage/crates/web`). A bisect names `93f5a664` (tiles at the power of two under the zoom
  while zooming), which only changes the scale, so it exposes the fault rather than making it.

## Not app bugs, but worth knowing

- The Rust tests' font files (`packages/stage/fonts/*.ttf`) are ignored by git and fetched by nothing.
  Without them every font-dependent test skips quietly, which is how the glyph bug above went unseen;
  copy them from a checkout that has them.
- The camera's opening fit lands about 2.5 s after the page opens: a check that reads the camera or
  places things after a short settle can act on the camera before it.
- Playwright's `locator.click()` scrolls its target into view first, and the stage is a scroll
  container now, so it can pan the canvas under the press: press by coordinates instead.
