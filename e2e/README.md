# Browser checks

Chromium comes from Playwright, which is a devDependency — a fresh clone needs its browser
binary once:

```sh
npx playwright install chromium
```

```sh
npm run test:e2e                        # the twelve that need no model  (~2m, 297 assertions)
DECKS_E2E_AGENT=1 npm run test:e2e      # and the five that prompt an agent — slower, spends tokens
npm run test:e2e -- panel tiers         # just these
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

## What is covered, and what is not

There were forty-five of these and now there are twelve. The full suite took 8m 17s, and a
suite nobody runs between edits is not protecting anything; the twelve run in 1m 58s. They
were chosen for assertions per second and to cover one surface each, and they are 297 of the
old 857 assertions.

**The thirty-three that went are in git, not gone.** `git log --diff-filter=D --name-only --
e2e/checks` lists them; restoring one is a `git show` and a line in `CHECKS`.

Nothing asserts these any more, and the gaps are worth knowing before trusting a green run:

| Gone | What is no longer checked |
| --- | --- |
| `mobile.mjs` (771 lines) | the phone layout, and every real touch — it was the only file dispatching them through CDP |
| `embed-touch.mjs`, `embed-guard.mjs`, `embed-scroll.mjs`, `gestures.mjs` | gestures crossing into and out of an HTML embed |
| `board-kinds.mjs` | the three board formats — and `splitHtmlDeck` is now tested nowhere at all, since its unit test defers to this check |
| `file-drop.mjs`, `drop-targets.mjs` | dropping and pasting a file, and where it lands |
| `editing.mjs`, `rich-text.mjs`, `invented-component.mjs` | direct manipulation, marks edited in place, a component the agent invented |
| `thumbs.mjs`, `rail-scroll.mjs`, `renderers.mjs` | thumbnails, the board list's scroll, both canvas renderers |
| `chat-history.mjs`, `streaming.mjs` | paging back through a transcript, and the column while a reply arrives |
| `accounts.mjs`, `accounts-per-agent.mjs`, `model-picker.mjs`, `usage.mjs` | the account and model surfaces, and the usage panel |
| `web-bridge.mjs` | the shared-Chrome bridge with the real extension |
| the rest | `clusters`, `edge`, `dock`, `keys`, `no-flicker`, `deleted-board`, `agent-close`, `agent-camera`, `runtimes`, `annotate`, `preview`, `dormant-controls` |

`accounts.mjs` also carried the one assertion that was failing before the cut — the accounts
list's order. **Deleting it did not fix that; it removed the only thing reporting it.**

## Two rules

**Nothing is hardcoded to one machine.** The deck under test comes from `/api/deck`, not
from a path in the script.

**Wait for the app, never for the clock.** Every check used to pad its page load with
`waitForTimeout(2500)`. That was two thirds of the suite's runtime, and wrong twice over: a
board is ready in ~700ms, so most of it was slack, and it is still too short on a loaded
machine — simultaneously slow and flaky. `harness.open()` waits for every board to report
`window.__boardReady`. Where something has no observable signal — a CSS transition — use
`settle(page, ms)` and keep it short.

Removing the sleeps once took the suite from 189s to 33s, and the stricter waits found a bug
they had been hiding: a revision preview was loading without its stylesheet, so the time
machine showed the right *text* in an unstyled document. `resetStage` in `harness.mjs` is
the one place that still breaks this rule — it sleeps 400ms twice per check, measured at
810ms every time, which is about 8s of the twelve-check run.

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
- `open({ device: "iPhone 15" })` — the same, in a Playwright device context: `hasTouch`, the
  pixel ratio and the user agent. `context.mjs` uses it for the narrow viewport. Dispatching
  real touches needs a CDP session on the returned `context` (`context.newCDPSession(page)`);
  `mobile.mjs` did that and has been cut, so nothing does it today. A mouse hides exactly the
  bugs a touchscreen has, so a check that means to test touch must not use one.
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
