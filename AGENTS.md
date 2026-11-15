# AGENTS.md

The map of this repo for agents. Read it first, then the design.

## Where the design is

- `docs/rewrite/DESIGN.md`: what we build. The folders, the nine abstractions, the protocol's
  grammar, the ten rules, the waves. If the code and it disagree, tell Mason.
- `docs/rewrite/WORKING.md`: how we work. One checkout, one branch, lanes, commits, the machine.
- `docs/rewrite/lanes.json`: which paths each agent may write.
- Each folder's `README.md`: what it owns, what it may import, its rules, how to check it.

## What is where

The switch-over at the end of wave 2 is done: the new folders are workspaces named
`@decks/<folder>`, and the libraries still in packages/ keep their names until Loom moves them;
the old protocol package (packages/protocol) takes a name of its own until then.

New folders, today:

| path | what |
|---|---|
| `protocol/` | what every program agrees on: the glossary, schemas, shapes, every call and event. No disk, no network. |
| `protocol/calls` | one file per noun |
| `server/` | Decks-local, the canvas server; its kernel and one folder per feature |
| `harness/` | the agents app, a client of the server |
| `tools/` | check, the heavy lock, the gates, the fixtures, the generators |
| `tools/gates` | the ten rules as scripts, with their baselines |
| `tools/fixtures` | a small deck and drawings shared with Studio and the iPad app |
| `pen/` | the drawing's file format, the package @decks/pen (moved from packages/pen) |
| `ui/` | controls that know nothing of Decks, the package @decks/ui (moved from packages/ui) |
| `engine/` | the Rust drawing engine, the package @decks/engine (moved from packages/stage); its wasm is built, not kept |

Still to come, as DESIGN.md section 3 says: canvas (a library that moves from
today's packages), clients (sdk, cli, mcp, attach, extension), and docs/decisions.

Today's code, read only:

| path | what | moves to |
|---|---|---|
| `packages/api` | the two tables of calls | protocol |
| `packages/canvas` | the canvas page library | canvas |
| `scripts` | measures and old gates | tools |

## Words

The nouns, from `protocol/glossary.ts`: deck, canvas, item, card, file, frame, app, port, agent,
view, tab, studio, google; and the harness's own: chat, account, runtime.

- A **call** is `noun.verb`, the noun singular; a verb means the same on every noun:
  list, get, create, update, delete, move, copy. An item's verbs are pen.dev's ops.
- An **event** is `noun.verbed`. A **refusal** is `{ code, message, hint }`.
- A **feature** is a server folder that enters through `defineFeature`.

Retired words, allowed only in compat and upgrade folders:

- board: say card.
- stage: say canvas. The Rust engine's crates keep the word.

## Commands

| command | does |
|---|---|
| `node tools/check.mjs <folder>` | one folder's type check and unit tests, nothing else |
| `node tools/heavy.mjs -- <command>` | runs a heavy job under the lock; `--wait` to queue |
| `node tools/gates/run.mjs` | every gate against its baseline; `--only <gate>` for one |
| `node tools/gates/run.mjs --shrink` | lowers baselines after you fix old code |
| `node tools/gates/install-hooks.mjs` | installs the commit-msg and pre-commit hooks, once |
| `npm run gates:next` | the same as `node tools/gates/run.mjs` |

Heavy means: the whole repo's type check, the whole `npm test`, any browser check, `cargo`,
`xcodebuild`, `npm ci` or `npm install`. One at a time, through `tools/heavy.mjs`.

Set `REWRITE_AGENT=<your name>` in your shell. The lock records it and the pre-commit hook
checks your staged paths against your lane with it.

Commit only your paths: `git commit -m "..." -- <your paths>`. Never `git add -A`.

## The ten rules

Each is a gate in `tools/gates`. Old code is counted in a baseline that may shrink and never
grow; new folders start at zero.

1. A file holds 400 lines at most, a function 80. (`tools/gates/size.mjs`)
2. One name per thing; a retired word lives only in compat and upgrade. (`tools/gates/names.mjs`)
3. Imports go one way, through a folder's entry file only. (`tools/gates/imports.mjs`)
4. A call is declared once in the protocol and handled once. (`tools/gates/calls.mjs`)
5. Every folder has a README of 60 lines at most: owns, may import, rules, check.
   (`tools/gates/readme.mjs`)
6. A comment states the rule in 5 lines or fewer; the story goes in a numbered record in
   docs/decisions. No em dashes. (`tools/gates/comments.mjs`)
7. A commit title is 72 characters at most; the body says why and has a `Checked:` line.
   (`tools/gates/commits.mjs`)
8. A part of the page is three files: model, view, actions. (`tools/gates/parts.mjs`)
9. Changing values live in a store, never loose at the top of a file. (`tools/gates/state.mjs`)
10. Nothing built is in git; styles are scoped to their part. (`tools/gates/built.mjs`)

Two more: `tools/gates/lanes.mjs` (a commit stays in its author's lane) and
`tools/gates/agents-md.mjs` (this file is 150 lines at most and names only paths that exist).

## Imports

| folder | may import |
|---|---|
| protocol | nothing |
| pen, ui, engine | protocol at most |
| canvas | protocol, pen, ui, engine |
| server | protocol, pen, engine (for pictures) |
| clients | protocol |
| harness | protocol, clients/sdk, ui, the canvas's host entry |

A server feature imports the kernel and the protocol, never another feature's files.

## Plain words

Short sentences in comments, READMEs and messages. No em dashes. Write the rules in a folder's
README first, tests from those sentences, then the code.
