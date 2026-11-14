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

Only Lexicon edits `protocol/`. If you need a call, an event or a shape, ask Lexicon; do not invent one.
Only Warden edits the root `package.json`, the lockfile and the root `tsconfig` files. No new npm
dependency without asking Mason.

Until the switch-over, the old packages keep the `@decks/*` names. New folders are workspace packages
named `@decks-next/<folder>` (`@decks-next/protocol`, `@decks-next/server`, …). Warden renames them at
the switch-over.

## Commits

- Commit only your paths: `git add <your paths>`, then `git commit -m "…" -- <your paths>`. Never
  `git add -A`, `git add .` or `git commit -a`: another agent's half-written files are in the same tree.
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
