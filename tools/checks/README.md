# tools/checks

Today's browser checks, run unchanged against the new programs, and the tests of the tools.

## Owns

- `run.mjs`: `node tools/checks/run.mjs <check> ...` starts, for each check, Decks-local on a
  fresh copy of `tools/fixtures/deck`, the harness, and the page, then runs `e2e/checks/<check>.mjs`.
- `check.test.mjs`, `fixtures.test.mjs`: tests of `tools/check.mjs` and the fixtures.

## May import

Node's own modules. It starts the programs as processes and imports none of them.

## Rules

- A check runs alone: its own deck copy, its own home for the harness (`DECKS_DATA_DIR`), and
  ports of its own from 4612 up (`CHECKS_PORT`). Every program is stopped and the copy deleted
  after, whatever the result.
- No `DECKS_` variable of the calling shell reaches a program: a check never touches a real Decks.
- The page proxies the server, so a check's `DECKS_E2E_API` and `DECKS_E2E_WEB` are the page.
- How each program starts is the `PROGRAMS` table at the top of `run.mjs`; its owner says it.
- One check at a time is a heavy job; the whole suite is Mason's to run.

## Check

- `node tools/checks/run.mjs <check> ...`, directly: it takes a lock slot per check itself, and
  refuses under heavy.mjs (`CHECKS_VERBOSE=1` prints the last lines of a failure; `--only-server`
  starts Decks-local alone; `--agent` runs the agent checks).
- `node tools/check.mjs tools`.
