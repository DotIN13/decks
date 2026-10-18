# Browser checks

Chromium comes from Playwright, which is a devDependency — a fresh clone needs its browser
binary once:

```sh
npx playwright install chromium
```

```sh
npm run test:e2e                        # every check that needs no model, four at a time
DECKS_E2E_AGENT=1 npm run test:e2e      # and the five that prompt an agent — slower, spends tokens
npm run test:e2e -- panel tiers         # just these (a prefix of the file name)
DECKS_E2E_JOBS=1 npm run test:e2e       # one at a time — still a fresh deck each
DECKS_BACKEND=claude npm run test:e2e   # the same checks, on the Claude runtime
```

The checks are written against the UI and the protocol, not against a runtime, so the same
suite is the parity test for both: `DECKS_BACKEND=claude DECKS_E2E_AGENT=1 npm run test:e2e`
should pass exactly as `DECKS_E2E_AGENT=1 npm run test:e2e` does. Where one fails, it is
either a real gap in that backend or a check that was secretly specific to the other — both
worth knowing. A Claude run answers the runtime's permission questions automatically, since
the fixture is a throwaway copy.

## The runner

`run.mjs` gives **every check a deck and a server of its own**, and runs several at once:

- A pool of `DECKS_E2E_JOBS` workers (default 4). Worker *i* owns the port pair
  `DECKS_E2E_API_PORT + 2·i` / `DECKS_E2E_WEB_PORT + 2·i` (base 4329/4328), and runs one Vite
  (`npm run dev:web`) on its web port for the whole run.
- For each check, the worker copies `example/` to a fresh `decks-e2e-*` directory under the
  system temp, starts the server on it (`node --import tsx src/index.ts` in `apps/server`, the
  `start` script: no `--watch`, so saving a file mid-run cannot restart it), puts the whole deck
  in play (`resetStage`), runs the check — which opens its own browser — then stops that
  server (TERM, then KILL, its own process group only) and deletes the copy.
- So nothing a check does reaches another, and order does not matter. A check that fails in
  the full run fails alone too; run it alone before believing otherwise.
- Output is one line per check in the order of `CHECKS`, whatever order they finished in, with
  that check's own time (setup excluded; the average setup is printed under the totals). The
  schedule is longest-first, by the last run's times, cached in
  `node_modules/.cache/decks-e2e/timings.json`.

Use non-default ports while a live Decks is on 4329, e.g.
`DECKS_E2E_API_PORT=4529 DECKS_E2E_WEB_PORT=4528` (with four jobs: 4528–4535). The runner
refuses to start if *anything* is listening on any port it would use — another suite, a live
deck, a stale run — and then checks each server it started has the fixture open. That is not
hypothetical: a dev server left up once meant a whole parity run silently went against a
scratch deck. And `harness.preflight()` refuses to run unless the deck path contains
`decks-e2e`, because a stale server on the API port once meant a run dragged boards around in
a real deck. Stop a run with ⌃C or by its pid; never `pkill` by pattern, since other worktrees
run their own suites on other ports.

If the machine is loaded (another suite, a render), fewer jobs is the fix for timeouts that
are not failures.

## What is covered, and what is not

There were forty-five of these. The full suite took 8m 17s, a suite nobody runs between edits
is not protecting anything, so it was cut to twelve. The set has grown back to twenty-nine as
surfaces came back, and what follows is the part that is still not covered.

**What went is in git, not gone.** `git log --diff-filter=D --name-only -- e2e/checks` lists
it; restoring one is a `git show` and a line in `CHECKS`.

Nothing asserts these any more, and the gaps are worth knowing before trusting a green run:

| Gone | What is no longer checked |
| --- | --- |
| `mobile.mjs` (771 lines) | the phone layout, and every real touch — it was the only file dispatching them through CDP |
| `embed-touch.mjs`, `embed-guard.mjs`, `embed-scroll.mjs` | gestures crossing into and out of an HTML embed (`gestures.mjs` is back, for the canvas rather than for embeds) |
| `board-kinds.mjs` | the three board formats — and `splitHtmlDeck` is now tested nowhere at all, since its unit test defers to this check |
| `file-drop.mjs`, `drop-targets.mjs` | dropping and pasting a file, and where it lands |
| `rich-text.mjs`, `invented-component.mjs` | marks edited in place, a component the agent invented (`editing.mjs` is back, for direct manipulation) |
| `thumbs.mjs`, `rail-scroll.mjs`, `renderers.mjs` | thumbnails, the board list's scroll, both canvas renderers |
| `chat-history.mjs`, `streaming.mjs` | paging back through a transcript, and the column while a reply arrives |
| `accounts.mjs`, `accounts-per-agent.mjs`, `model-picker.mjs`, `usage.mjs` | the account and model surfaces, and the usage panel |
| `web-bridge.mjs` | the shared-Chrome bridge with the real extension |
| the rest | `clusters`, `edge`, `dock`, `keys`, `no-flicker`, `deleted-board`, `agent-close`, `agent-camera`, `runtimes`, `preview`, `dormant-controls` |

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
machine showed the right *text* in an unstyled document. After something that may move the
camera (a Fit, a `1`, a stage card), wait with `rest(page)` — for the move to begin and end
and the pages it brought to mount — rather than a pause as long as the longest glide.

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
  A board nobody holds is not on the canvas, and a leftover fixture changes what the rest
  of the same check sees.

## Things that have bitten

- **State leaks between checks.** They used to share one server and one deck, and five
  checks failed only in full order. Each check now has its own; within a check, clicking a
  rail item still plays that board *and only that board*.
- **Assertions that cannot fail.** `say("...", x !== undefined)` and `ok || true` both
  shipped here. If a check has never failed, break the code and watch it fail.
- **`src` changes before the document does.** Waiting for an iframe's URL and then reading
  its DOM reads the *old* document. Mark the live document and wait for the mark to go.
