# Known failures

What fails on studio-canvas after the tidy-up of 2026-10-28, and why. Each line is an app bug a check
found, not a check that is out of date; the check is left failing (or works around it, where it says
so) until the bug is fixed. Remove a line when its fix lands.

Last full runs on this Mac (2026-10-28): with 2 workers, 973 assertions passed and 1 failed
(`media`, below); with the default 4 workers, 2 to 4 checks fail, a different few each run.

## App bugs

None known.

## Flaky under load

With 4 workers on this Mac (an M4 mini), 2 to 4 checks fail in a full run, and which ones changes
from run to run. Each of them passes when run alone (`node e2e/run.mjs <check>.mjs`). They fail
because the machine is busy: a press, a glide or a page load takes longer than the check allows.
They are not failing because of the app. Seen in the last runs: `stage-scroll`, `media` and `frames` find
no empty spot; `camera-roundtrip`, `board-links`, `stage-gestures`, `pen-stage`, `card-phone`,
the WebKit half of `drop-lands`, and `context`'s finger drag of a board. `DECKS_E2E_JOBS=2` mostly avoids it (one
flake in 66 checks), at twice the time (12 minutes).

## Not app bugs, but worth knowing

- The Rust tests' font files (`packages/stage/fonts/*.ttf`) are not in git: `npm run fonts -w packages/stage`
  fetches them, checked to the byte (`stage-goldens` does it itself). Without them every test that sets
  words skips quietly, which is how a glyph texture bug went unseen.
- Playwright's `locator.click()` scrolls its target into view first, and the stage is a scroll
  container now, so it can pan the canvas under the press: press by coordinates instead.

## The canvas in its frame (full run 2026-10-29)

Whole suite on the canvas frame, `DECKS_E2E_JOBS=2`, ports 4610/4611: the 54 default checks, 928 assertions passed and 2
failed (tiers, focus), then the named ones (edits-wait, nudge, arrows-steady, text-shots). The checks that need a model
(agent-rows, stage-api, running, time-machine, chrome) were not run. After the fixes below everything passes except
edits-wait.

### App bugs

- edits-wait (named, Chromium): "a board hidden from its pill: no frame shows it as it was" — 1 or 2 of ~145 frames
  after the click still have the board (two runs out of two). The frame takes it off at once (`frame.tsx`, `takeOff`, a
  local delete edit), but the engine's boards (`__decksRust.placedCards`) lag the edit by a frame or two. Small, visible for
  ~15–30 ms. WebKit's "a note made by a double-click … 1 of 92 frames old (count)" was seen once alone and passed in the
  run beside the others: left as a timing flake.

### Fixed in this run (2026-10-29)

- The render worker in Safari's engine: in the sandboxed frame WebKit makes `new Worker(<server url>, module)` and fails
  it a moment later with an `error` event instead of throwing, so the `data:` worker was never tried and nothing drawn
  was painted (backends, note-edges, tile-pixels, context-loss in WebKit). `startWorker` (`render/engine.ts`) goes to the
  `data:` module worker at once on an opaque origin. Notes, shapes, arrows and ink are painted in WebKit, desktop and
  iPhone emulation.
- one-picture: the frame asked for a board's picture without `whole=1`, so the server sent the gallery card's picture,
  never at the GPU's widths and never compressed (`frame.tsx`). And a ticketed answer now exposes `X-Decks-Stand-In` to
  the frame (`auth/guard.ts`), so a stand-in is asked for again.
- context-loss waited on the page for `__decksEngine`, which is in the frame (check bug).
- focus expected a comment's pill to read only the board's name; it shows the whole comment, marked "from the canvas"
  since d0c7ffaa (check out of date).
- stage-shot, placeholder, tile-pixels, note-edges, backends, pen-stage pass (they failed only on the render worker).

### Still worth knowing

- per-agent: a new canvas frame opens on the camera its host last put it at (`editor.tsx`), fixed 2026-10-29.
- stage-gestures: "a scroll during a drag keeps the items and the board under the cursor" was seen once under load; a
  timing flake.
- pen-stage: `__decksEngine.stats()` can report tiles 0 while the canvas is drawn (`__decksSheet.shown` > 0); the check
  also accepts the sheet's count.
- Playwright's `locator.click()` on a frame element sometimes lands on the page's side panel (the stage scrolls the
  target into view first): press by coordinates.
- The frame probe (`?probe=<collector>`, `apps/web/src/perf/probe.ts`) runs in the canvas frame; the page passes the
  parameter on and keeps `__probeEval` for an inspector (`scripts/ipad-profile.mjs`).

## After the board-leftovers steps 1–2 (2026-10-30)

A full run (3 workers) failed tiers, pen-stage, context-loss and drop-lands; all four failed the same way on 30df5333,
before the steps.

- pen-stage, drop-lands (and the named arrows-steady, nudge, edits-wait) read `__decksRust.boards`, which the card
  rename (262d23c2) made `placedCards`: check bug, fixed.
- context-loss: a lost WebGL context did not drop the engine's record of the pictures the GPU held (`pictureBytes`,
  `heldWidth`, `compressedSize`), so after the restart the picture ladder (262d23c2) thought every card still had its
  picture and fetched none: nothing was drawn. `lose()` (`render/engine.ts`) clears them now. App bug, fixed.
- tiers' "the hide button takes a board off the stage" fails under load (the full run, four checks at once) and passes
  alone (three runs out of three). The board leaves the frame, is drawn again for a moment, and is gone by the time the
  message is written: the first read of `__decksBoards` still had it, the second did not. Likely the same lag as
  edits-wait's hidden board (an echo of the stage from before the hide), not fixed.
