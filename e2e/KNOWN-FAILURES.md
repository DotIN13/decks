# Known failures

What fails on dev, and why. Each line is an app bug a check found, not a check that is out of date; the
check is left failing (or works around it, where it says so) until the bug is fixed. Remove a line when
its fix lands. The older sections below are kept as the record of each run.

Last full run on this Mac (2026-11-27, branch e2e-fix on dev 0b29be2a, `DECKS_E2E_JOBS=2`, ports
4640/4641): 1,555 assertions passed and 0 failed; one check, `tiers`, timed out under load (below) and
passes alone, three runs out of three. The five checks that need a model were not run.

## App bugs

None known.

## Not run here: the native renderer

`card-frame`'s screenshot corners and `stage-shot`'s "drawn natively" lines are the native renderer's
(`cargo build --release -p stage-shot` in packages/stage, or `DECKS_CANVAS_SHOT`). This Mac has no cargo,
so the server falls back to Chromium and both checks skip those lines, saying so. `card-frame` used to
take Chromium's answer for native (its `how`, "chromium: the native renderer is not built …", matched
`/native/`) and failed on the corner; `stage-shot` looked for a binary called `canvas-shot`, which the
rename gave a name the binary does not have.

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
  local delete edit), but the engine's boards (`__decksProbes.rust.placedCards`) lag the edit by a frame or two. Small, visible for
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
- context-loss waited on the page for `__decksProbes.engine`, which is in the frame (check bug).
- focus expected a comment's pill to read only the board's name; it shows the whole comment, marked "from the canvas"
  since d0c7ffaa (check out of date).
- stage-shot, placeholder, tile-pixels, note-edges, backends, pen-stage pass (they failed only on the render worker).

### Still worth knowing

- per-agent: a new canvas frame opens on the camera its host last put it at (`editor.tsx`), fixed 2026-10-29.
- stage-gestures: "a scroll during a drag keeps the items and the board under the cursor" was seen once under load; a
  timing flake.
- pen-stage: `__decksProbes.engine.stats()` can report tiles 0 while the canvas is drawn (`__decksProbes.sheet.shown` > 0); the check
  also accepts the sheet's count.
- Playwright's `locator.click()` on a frame element sometimes lands on the page's side panel (the stage scrolls the
  target into view first): press by coordinates.
- The frame probe (`?probe=<collector>`, `apps/web/src/perf/probe.ts`) runs in the canvas frame; the page passes the
  parameter on and keeps `__probeEval` for an inspector (`scripts/ipad-profile.mjs`).

## After the board-leftovers steps 1–2 (2026-10-30)

A full run (3 workers) failed tiers, pen-stage, context-loss and drop-lands; all four failed the same way on 30df5333,
before the steps.

- pen-stage, drop-lands (and the named arrows-steady, nudge, edits-wait) read `__decksProbes.rust.boards`, which the card
  rename (262d23c2) made `placedCards`: check bug, fixed.
- context-loss: a lost WebGL context did not drop the engine's record of the pictures the GPU held (`pictureBytes`,
  `heldWidth`, `compressedSize`), so after the restart the picture ladder (262d23c2) thought every card still had its
  picture and fetched none: nothing was drawn. `lose()` (`render/engine.ts`) clears them now. App bug, fixed.
- tiers' "the hide button takes a board off the stage" fails under load (the full run, four checks at once) and passes
  alone (three runs out of three). The board leaves the frame, is drawn again for a moment, and is gone by the time the
  message is written: the first read of `__decksProbes.cards` still had it, the second did not. Likely the same lag as
  edits-wait's hidden board (an echo of the stage from before the hide), not fixed.

## The fixture is cards (board-leftovers step 5, part 3, 2026-10-30)

The fixture deck's five library boards are now the five cards of `canvases/auth-refresh/` (put through the
boards-to-cards migration, stacked with their right-hand edges in line), and the one board left is on a friend's
shared canvas (`shared/canvases/ada/old-notes/`, checked by `old-board.mjs`). The full run (3 workers): 983 assertions
passed; a second run after the fixes below, 981 passed and 2 failed (glide's last frames still moving, engine-slide's
small pan drawing), both passing alone. Named: nudge, arrows-steady and text-shots pass; edits-wait fails as above
(a hidden card lags a frame or two in `placedCards`).

### App bugs found and fixed

- A card placed on a canvas from another canvas was copied as an old board (`boards/cards/<name>/index.html`, its
  folder left behind); it is copied with its whole folder into `cards/<name>/` and stays a card (`canvas/copy-in.ts`).
- A finger's tap on a live card selected nothing (the card passed touches on to the stage, which saw no picture under
  them); a finger's press on a card's content now picks it, and still pans (`card-surface.tsx`). context's phone tap.
- A Shift- (or ⌘-) press on a live card picked it alone, dropping the selection; it goes to the editor as a press on
  the card's edge does and adds it (`PageView.press`, `card-surface.tsx`). nudge's "a board and two items".
- The Canvas tab listed a card with no name as "index"; it is listed by its folder (`model/layers.ts`).

### Check changes worth knowing

- `deckState()` reads each card's place from its canvas file: the deck's own `x`/`y` are the seed a new stage lays
  out from, and stage-gestures had been steering by them (they happened to match the old boards).
- A card is carried by its edge band, not its content (a press inside a card is the card's): stage-gestures drags by
  the band. drop-lands moves the view onto bare canvas before it draws, so its drawings lie over no card.
- tile-pixels allows its Chromium seams on 0.25% of the pixels (was 0.05%): with the cards in one narrow column, two
  seams' whole height is bare canvas.
- Brought up afterwards: `perf-canvas.mjs` (render-perf, pan-heavy) builds a canvas of cards (pan-heavy's `real` canvas
  is copied as it is, and the perf cards are copies of its cards when it has any); render-perf presses the pen in the
  canvas frame, and pan-heavy waits for the cards there. stage-api (needs a model, not run) reads the Canvas tab's
  card rows by title. card-fit checks that `decks canvas fit` measures a card alike with and without a canvas open.

## After the refactor (2026-11-16)

Full runs at the end of the canvas package's refactor (f8e03110, 3 workers): 1,156 of 1,158 assertions.
`card-frame`'s framed corner is the picture renderer this clone lacks; `tiers`' hide button fails beside
two other workers and passes alone, as above. `nudge` and `arrows-steady` pass when named.

- edits-wait (named) never reaches its WebKit half. Its Chromium half hides a card from its pill, and
  `resetStage` (`harness.mjs`) between the two engines only moves each fixture card back (`card.move`):
  a card taken off the canvas is not put back, so it waits 25 s and throws "4 of 5 cards reached the
  stage". The same throw at the branch's base (f7f0d20f) and before the canvas refactor (30830792): a
  check bug that predates both, not fixed. The Chromium half's "a board hidden from its pill" failed
  there (1 or 2 of ~150 frames) and passed at f8e03110, which a frame or two of timing explains.

## After the card and canvas rename (2026-11-27)

The first full run after the rename (0b29be2a) had 37 checks failing, 62 assertions. All pass now
(`tiers` as above).

### App bugs found and fixed

- Escape with Settings' sound picker open shut all of Settings: Settings hears Escape first, in the
  capture phase (bb1f6932), and never let the open popover have it (`settings/Settings.tsx`).
  notifications.
- A selected item's pill could not be pressed after a Fit: since Fit keeps clear of the composer
  (fc832a6d) it frames an item 24 px under the top bar, and the pill stayed in the slot above, chosen
  before the glide, hidden under the bar; the slot below was under the composer, which the frame cannot
  see. The pill's slots now keep clear of the chrome the page tells the frame (`fitBox`), it chooses
  again when it shows with its edge on screen but its slot not, and with no slot clear it slides onto
  the screen over the item's edge (`ui/callout-side.ts`). tab-document, tab-app.

### Checks out of date, updated

- The harness's line read `canvas.list`'s `stages` (now `canvases`), so it never knew which canvas an
  agent was on and every edit and drawing it read came back empty: pen-stage, stage-gestures, shapes,
  frames, media, same-drawing, canvas-frame, tools-on-page, item-pill and the others with
  `link.drawing(...)`. Other checks read `stages` themselves (placement-views, placement-at, items-made,
  drop-clear, stages, canvas-frame, and the app checks).
- The Objects tab (was Canvas) and its card rows' `data-kind="card"` (was `board`): panel, tiers, shell,
  agents-tab, glide, tabs, stage-api, walkthrough.
- A card's ⋯ menu starts with Reload: focus. Settings opens on General: notifications presses
  Notifications before reading it.
- `<meta name="card">` (was `board`): geometry. Canvas pictures under `.decks/thumbs/canvases/`:
  canvas-pictures. Agent rows' `cards` (was `boards`) in the checks' fake rosters.
- A place with no point steps right past what is in the way (fc267d28), so the new item lands just past
  the hand-drawn note, 580 px from the newest card: placement-views asserts that spot, not "under 500 px".
- A camera move made outside a window used in the last half minute is offered (Follow) rather than taken
  (953b43c5): tabs-kept presses Follow, and asserts the offer.
- The fixture's five card pages were written with the 0.6.0 migration's own code (`planNames`), so they
  say `<meta name="card">` as the app writes; the friend's shared canvas is left as it was, as the
  migration leaves it.
- Failing in the first run only because WebKit was missing or for the harness's `stages`: layers-webkit,
  backends, context-loss, one-picture, note-edges, tile-pixels, stage-goldens, drop-lands, card-copy,
  old-board.
