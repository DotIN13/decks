# The rewrite: how we work

For every agent on the rewrite. `DESIGN.md` beside this file is what we build; this is how. Mason is the
integrator: questions, blocks and reports go to Mason.

## Where

- Work only in `/Users/dotin13/Documents/DotGit/dotty-project/decks-dev`, on branch `rewrite`. Use
  absolute paths: your shell starts inside the person's running Decks, which is not this checkout.
- **Never touch `/Users/dotin13/Documents/DotGit/dotty-programs/decks`** (the live Decks) except your own
  progress card's `progress.json` and the decisions card's, in its deck folder.
- Never: a new worktree, another branch, `stash`, `rebase`, `reset`, `push`, a deploy, restarting a
  service, `launchctl`. One checkout, one branch, shared by all of us.

## Your folders

`lanes.json` beside this file lists the paths each agent owns. Write only inside yours. `apps/`,
`packages/`, `runtime/`, `e2e/`, `scripts/` and `extension/` are the old code: read them, never change
them. If you need a change in a path that is not yours, ask its owner with
`decks agent send <name> --task "…"`, or Mason.

Warden also owns each new top folder's `package.json` and `tsconfig.json` in `server/` and `harness/`, so every
folder's type-check project has one shape. In `clients/`, the folder's owner writes them to that shape.

Only Lexicon edits `protocol/`. If you need a call, an event or a shape, ask Lexicon; do not invent one.
Only Warden edits the root `package.json`, the lockfile and the root `tsconfig` files. No new npm
dependency without asking Mason.

Until the switch-over, the old packages keep the `@decks/*` names. New folders are workspace packages
named `@decks-next/<folder>` (`@decks/protocol`, `@decks/server`, …). Warden renames them at
the switch-over.

## Commits

- Commit only your paths: `git add <your paths>`, then `git commit -m "…" -- <your paths>`. Never
  `git add -A`, `git add .` or `git commit -a`: another agent's half-written files are in the same tree.
- Once Warden's hooks are installed, set `REWRITE_AGENT=<your name>` in the environment of every commit:
  the lanes gate reads it to check you touched only your own paths. (`DECKS_AGENT` is the harness's, an id.)
- If `.git/index.lock` exists, another agent is committing: wait a few seconds and try again.
- A title of 72 characters at most, saying what changed. A body saying why, and a `Checked:` line with
  the commands you ran. One idea per commit.
- Before each commit: your folder's type check and unit tests pass.

## The machine

One Mac, 16 GB of memory, shared with the person's own work.

- **One heavy job at a time.** Heavy means: a type check of the whole repo, the whole `npm test`, any
  browser check, `cargo`, `xcodebuild`, `npm ci` or `npm install`. Take the lock first:
  `mkdir /tmp/decks-rewrite-heavy.lock && echo "<your name> $(date)" > /tmp/decks-rewrite-heavy.lock/owner`,
  and `rm -rf` it when the job ends, also when it fails. If the lock is held, wait and do other work. A
  lock older than 30 minutes is stale: tell Mason, do not break it yourself. (Warden is building
  `tools/heavy.mjs` to do this for you; use it once it exists.)
- **Disk.** Before a heavy job, check free space: `df -g /System/Volumes/Data`. Under 8 GB free, stop and
  tell Mason. Scratch files go in `.scratch/<your name>/` in the checkout; delete them when you finish.
- **Ports.** Use only your own range, given in your brief. Never 4328, 4329 or 3040 to 3060.
- Your own folder's type check and unit tests are not heavy: run them as often as you like.

## Rules first

Write the folder's rules in its `README.md`, write tests from those sentences, then the code. Do not port
line by line and do not build a harness that compares with the old code. New folders start with no
exceptions to the ten rules in `DESIGN.md` section 6: 400 lines a file, 80 a function, comments of 5
lines or fewer, plain words, no em dashes.

## Progress, decisions, reports

- **Your progress card** is one `progress.json`, at the path in your brief. Keep it true after every
  step: the step's status, its tests with real counts and the command, the files you changed and why.
  Edit it in place (never a rename-save such as `sed -i`). It is what the person watches.
  A step's `tests` is a **list**, each entry `{ "suite": "…", "passed": 12, "failed": 0, "failures": ["name"],
  "command": "…" }`. Not a sentence and not one bare object: a wrong shape once left cards blank.
- **A decision for the person** goes in the decisions card's `progress.json` (path in your brief), as an
  entry in `decisions` with `"agent": "<your name>"`, a question, why it matters, and options with one
  marked `"recommended": true`. Read the file just before you write it, and change only your own
  entries. Go on with the recommended option unless the decision blocks you. When the person answers,
  a message reaches you: set `"answer"` on that entry.
- **Your report** is your last message when your work is done or you are blocked. It goes back to Mason.
  Say what is done against each "done when" in your brief, what is not, the test commands and their
  results, and what you would ask the person. Do not make other cards.

## First thing

Say who you are: `decks agent update --avatar.svg '<svg …>' --workspace decks-rewrite --tags '["…"]'`
with an avatar you draw. Then read `DESIGN.md`, this file, and your brief.

## Wave 1: five agents in `server/` and `clients/`

- **The kernel's interfaces** (`server/kernel/types.ts`) are Keel's now. They only grow: Keel adds, never
  changes or removes, and tells Easel, Folio, Roster and Lexicon each time. If you need something from the
  kernel, ask Keel; do not reach around it.
- **Testing a feature.** Keel's first job is a testing module in the kernel: a real router on the in-memory
  deck, so a feature's calls are tested as calls. Until Keel says it is there, test your modules directly.
- **A feature never imports another feature.** What crosses goes through the handler's context
  (`ctx.canvas(name)`, `ctx.deck`, `ctx.events`), an item kind, or a call. If that is not enough, ask Keel
  for a seam; do not import a neighbour's file.
- **A declared call you do not handle yet** (it belongs to wave 2) is simply left out of your feature. The
  router answers it `unavailable`. Say which ones in your README.
- **Dependencies.** `server/package.json` is Warden's. Ask Warden by `decks agent send Warden` for a
  package you need, with the reason; Warden installs under the heavy lock.
- **Commits** need `REWRITE_AGENT=<your name>` in the environment; the hooks are installed in this checkout.
- **Checks**: `node tools/check.mjs server` (or `clients/<name>`) and `node tools/gates/run.mjs` before
  each commit. Neither is heavy.
- **Ports**: Lexicon 4600 to 4609, Keel 4620 to 4629, Easel 4630 to 4639, Folio 4640 to 4649, Roster
  4650 to 4659.

## Say when you are done, and do not hold the lock

Mason sees your commits and your messages, not your state. Two rules, added on 2026-11-14 after work
sat waiting for an hour:

- When a step someone waits on is done, send it at once:
  `decks agent send Mason --task '<your name> done: <what, the commit, what you ran>'`.
  A report at the end of a turn does not reach Mason.
- Take the heavy lock for one run, never for a loop of runs. Ten runs are ten takes, so others get a
  turn between them. Write what you wait for in your progress file's `doing` before you wait.

Browser checks: call `node tools/checks/run.mjs <check>` directly; it takes a slot per run, two checks at
once, timed checks alone. `node tools/heavy.mjs --wait -- <command>` is for builds, installs and the whole
type check, which run alone. Do not wrap `run.mjs` in `heavy.mjs`.
