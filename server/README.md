# server

Decks-local, the canvas server: it answers the protocol's calls for one deck, and starts no agent.

## Owns

- main.ts: builds the kernel and hands it the list of features; the only place a feature is named.
- `kernel/`: the deck, history, callers, the router, events, `defineFeature`, the lock file and the
  three doors (HTTP, socket, MCP). It names no feature.
- One folder per feature: `canvas/`, `cards/`, `documents/`, `apps/`, `pictures/`, `people/`,
  `tab/`, `sharing/`, `upgrade/`, and `compat/` for old call names, each with the date it goes.

Each feature has the same names inside: `README.md`, feature.ts (its one export), calls.ts
(one short handler per call), its modules with a test beside each, and `checks/`.

## May import

`protocol/`, `pen/`, and `engine/` for pictures. Never `harness/`, `canvas/`, `ui/` or `clients/`.
A feature imports the kernel and the protocol, never another feature's files.

## Rules

- Only kernel/deck.ts touches the disk; every read and write goes through `Deck`.
- A handler sees `ctx` (caller, deck, canvas, events, note), never a token, and cannot tell
  whether it runs here or in Studio.
- A call is declared in `protocol/` and handled once, in its feature's calls.ts.
- New code is built beside today's `apps/server`, which stays working until the switch-over.

## Check

- `node tools/check.mjs server`: this folder's type check and unit tests, nothing else.
- `node tools/gates/run.mjs`: the ten rules.
