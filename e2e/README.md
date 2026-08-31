# Browser checks

Chromium comes from Playwright, which is a devDependency — a fresh clone needs its browser
binary once:

```sh
npx playwright install chromium
```

```sh
npm run test:e2e                        # everything that does not need a model  (~35s)
DECKS_E2E_AGENT=1 npm run test:e2e      # including the five that prompt an agent (~80s)
npm run test:e2e -- keys gestures       # just these
DECKS_BACKEND=claude npm run test:e2e   # the same checks, on the Claude runtime
```

The checks are written against the UI and the protocol, not against a runtime, so the same
suite is the parity test for both: `DECKS_BACKEND=claude DECKS_E2E_AGENT=1 npm run test:e2e`
should pass exactly as `DECKS_E2E_AGENT=1 npm run test:e2e` does. Where one fails, it is
either a real gap in that backend or a check that was secretly specific to the other — both
worth knowing. A Claude run answers the runtime's permission questions automatically, since
the fixture is a throwaway copy.

The runner also refuses to run if something *else* is already serving port 4329. That is not
hypothetical: a dev server left up meant a whole parity run silently went against a scratch
deck and reported a result that meant nothing.

The runner (`run.mjs`) copies `example/` to a throwaway directory under the system temp,
starts the dev server on it, runs each file in `checks/`, and deletes it. Nothing here ever
touches a deck you are working in: `harness.preflight()` refuses to run unless the deck
path contains `decks-e2e`, which exists because a stale server on the API port once meant a
run went against a real deck and dragged boards around before anyone noticed.

## Two rules

**Nothing is hardcoded to one machine.** The deck under test comes from `/api/deck`, not
from a path in the script.

**Wait for the app, never for the clock.** Every check used to pad its page load with
`waitForTimeout(2500)`. That was two thirds of the suite's runtime, and wrong twice over: a
board is ready in ~700ms, so most of it was slack, and it is still too short on a loaded
machine — simultaneously slow and flaky. `harness.open()` waits for every board to report
`window.__boardReady`. Where something has no observable signal — a CSS transition — use
`settle(page, ms)` and keep it short.

The suite went from 189s to 33s this way, and the stricter waits found a bug the sleeps had
been hiding: a revision preview was loading without its stylesheet, so the time machine
showed the right *text* in an unstyled document.

## Writing one

```js
import { open, say, boardPath, read, write, changed } from "../harness.mjs";

const { browser, page, errors } = await open();          // clears localStorage, waits for boards
say("something true", await page.evaluate(() => true));  // sets the exit code on failure
say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
```

- `say(name, ok, detail)` — one line of output; a failure sets a non-zero exit code.
- `open({ width, height, scheme })` — a page with storage cleared and the boards mounted.
- `open({ device: "iPhone 15" })` — the same, in a Playwright device context: `hasTouch`,
  the pixel ratio and the user agent. `mobile.mjs` uses it and drives gestures with
  `Input.dispatchTouchEvent` over a CDP session (`context.newCDPSession(page)`), never with
  the mouse — a mouse hides exactly the bugs a touchscreen has, and two of the ones that
  check now covers were invisible to every other check in here.
- `boardPath(name)` / `read` / `write` / `changed(file, was)` — the fixture's files.
- `socket()` — drive the protocol the way the client does (`board.play`, `board.patch`).
- `ask(page, text)` / `idle(page)` — one agent turn. Never swallow the timeout: a prompt
  typed into a still-running turn truncates it, and the truncated reply reads as a bug.
- A check that creates boards must play them (`board.play`) and delete them in a `finally`.
  A board nobody holds is not on the canvas, and a leftover fixture changes what the next
  check sees.

## Things that have bitten

- **State leaks between checks.** They share one server and one focused agent, so the
  runner puts the whole deck back in play before each file. Clicking a rail item plays that
  board *and only that board*.
- **Assertions that cannot fail.** `say("...", x !== undefined)` and `ok || true` both
  shipped here. If a check has never failed, break the code and watch it fail.
- **`src` changes before the document does.** Waiting for an iframe's URL and then reading
  its DOM reads the *old* document. Mark the live document and wait for the mark to go.
