# harness

The agents app: a client of the server that runs agents and shows the person their page.

## Owns

- `main.ts`, `host.ts` (a client's line to the server), `calls.ts` (the harness's own calls,
  for the person only: `chat.*`, `account.*`, `runtime.*`), `voice.ts`.
- `sessions/`: sessions, their queue, transcript, timeline, identity and tools.
- `runtimes/`: one folder per kind of agent (claude, pi, opencode, antigravity) behind `Runtime`.
- `accounts/`: logins and usage limits.
- `prompts/`: what an agent is told: the template, guidelines, skills, the generated reference.
- `page/`: the person's page, one folder per area, each part three files.

## May import

`protocol/`, `clients/sdk`, `ui/`, and the canvas's host entry. Never `server/`.

## Rules

- The harness reaches the deck only through calls, as any other client does.
- A part of the page is three files: `model.ts` (state and rules, no DOM, unit-tested),
  `view.tsx` and `actions.ts`. Its styles sit beside its view.
- Changing values live in a store, never loose at the top of a file.
- New code is built beside today's `apps/web`, `apps/server/src/agents` and `runtime/`.

## Check

- `node tools/check.mjs harness`: this folder's type check and unit tests, nothing else.
- `node tools/gates/run.mjs`: the ten rules.
