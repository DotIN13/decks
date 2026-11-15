# tools

What builds, checks and measures the repo; none of it ships in Decks.

## Owns

- `check.mjs`: `node tools/check.mjs <folder>` runs one folder's type check and unit tests.
- `heavy.mjs`: `node tools/heavy.mjs [--wait] [--class check] -- <command>` runs heavy jobs in turn:
  exclusive (the default) alone, check two at once.
- `gates/`: the ten rules as scripts, with their baselines (see its README).
- `fixtures/`: a small deck and drawings with their expected layouts, shared with Studio and iOS.
- `gen/` (Lexicon): generates what follows from the protocol into `dist-gen/`.
- Later: `measure/` and `checks/`, today's `scripts/` and `e2e/`, at the switch-over.

## May import

Anything in the repo: tools read every folder. Nothing in the repo imports tools.

## Rules

- Exclusive, alone: a type check of the whole repo, the whole `npm test`, `cargo`, `xcodebuild`,
  `npm ci`, `npm install`, a page build. Run it through `heavy.mjs --wait --`.
- Browser checks: `node tools/checks/run.mjs <check> ...`, directly. It takes a check slot for each
  run (two at once), alone for a check that measures time, never for the whole loop.
- A new folder's project: `<folder>/package.json` named `@decks-next/<folder>` (`type: module`,
  `exports` pointing at `.ts` files) and `<folder>/tsconfig.json` that extends
  `tsconfig.folder.json` with `include: ["**/*.ts"]`. That base has no node types; a folder that
  needs them adds `"types": ["node"]`. Under `clients/<name>/`, extend `../../tsconfig.folder.json`.
- Tests sit beside their module as `<name>.test.ts` (or `.test.mjs`), run by `node:test`.
- Environment: `REWRITE_AGENT=<your name>` for commits and the lock.

## Check

- `node tools/check.mjs tools`: the tests of `heavy.mjs`, the gates and `check.mjs`.
- `node tools/gates/run.mjs`: every gate.
