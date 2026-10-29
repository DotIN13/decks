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
`highlighting`, the WebKit half of `drop-lands`, and `context`'s finger drag of a board. `DECKS_E2E_JOBS=2` mostly avoids it (one
flake in 66 checks), at twice the time (12 minutes).

## Not app bugs, but worth knowing

- The Rust tests' font files (`packages/stage/fonts/*.ttf`) are not in git: `npm run fonts -w packages/stage`
  fetches them, checked to the byte (`stage-goldens` does it itself). Without them every test that sets
  words skips quietly, which is how a glyph texture bug went unseen.
- Playwright's `locator.click()` scrolls its target into view first, and the stage is a scroll
  container now, so it can pan the canvas under the press: press by coordinates instead.
