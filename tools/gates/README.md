# tools/gates

The ten rules of `docs/rewrite/DESIGN.md` section 6, plus lanes and the map, as scripts that fail.

## Owns

- One file per rule: `size.mjs` (1), `names.mjs` (2), `imports.mjs` (3), `calls.mjs` (4),
  `readme.mjs` (5), `comments.mjs` (6), `commits.mjs` (7), `parts.mjs` (8), `state.mjs` (9),
  `built.mjs` (10).
- Rule 1's limits: a file over 1,000 lines, a function over 80 (`FILE_MAX` and `FUNCTION_MAX` in `size.mjs`).
- `lanes.mjs`: a commit touches only its author's paths in `docs/rewrite/lanes.json`.
- `agents-md.mjs`: `AGENTS.md` is 150 lines at most and names only paths that exist.
- `legacy.mjs`: calls the four gates in `scripts/` from before the rewrite.
- `strays.mjs`: rule 1's story: a doc comment on its item, a heading with something under it, a named path that exists.
- `indent.mjs`: rule 1's story: a line inside a block sits deeper than the line that opened it (no formatter here).
- `baseline/`: each gate's exceptions today, as key and count. Only old code is in them.
- `run.mjs` runs them all; `install-hooks.mjs` installs the commit hooks.

## May import

Node's own modules, `typescript` (for its parser), and `lib.mjs` beside them. Nothing of Decks.

## Rules

- A baseline may shrink and never grow. `run.mjs` fails a key that is new or above its count,
  and a baseline that gained a key since HEAD.
- New folders start at zero exceptions. A first baseline (`--init`) keeps old folders only.
- A gate that cannot check part of its rule says so in a note on every run.
- Each gate has a test that plants one break in a scratch folder and sees it named.

## Check

- `npm run gates:next`, or `node tools/gates/run.mjs` (`--only <gate>` for one).
- After fixing old code: `node tools/gates/run.mjs --shrink`, then commit the smaller baseline.
- Tests: `node tools/check.mjs tools`.
- After moving a file or folder: `node tools/gates/rekey.mjs <old> <new>` (`--staged` for every
  `git mv` staged, `--file <x.renames.json>` for a Loom move table), then commit the baselines with the move: its exceptions keep their counts.
