# tools/switch

The switch-over: today's code the new folders replaced goes, the new packages take the @decks names,
and the browser checks move to the features that own them.

## Owns

- `run.mjs`: `node tools/switch/run.mjs --dry` prints the plan and writes `docs/rewrite/switch-plan.md`;
  with `--stop-3-passed` (only after Mason says stop 3 passed) it carries it out as commits.
- `plan.mjs`: the plan, worked out from the tree as it is; reads only.
- `render.mjs`: the plan as Markdown.
- `compat/old.mjs`: today's names the plan must say (the packages Loom keeps).

## May import

Node's own modules and the files beside it. It reads the repo; it imports none of it.

## Rules

- A folder is deleted only when its new home exists and nothing that stays imports it; otherwise
  the plan says it is not deleted, and why.
- Nothing in any deck is touched. "Apps" is the repo's apps/ source folder.
- Each step is one commit, made only after the gates pass, staging only the switch's own paths.
- Without `--dry` and without `--stop-3-passed` it refuses.

## Check

- `node tools/switch/run.mjs --dry`
- `node tools/gates/run.mjs`
