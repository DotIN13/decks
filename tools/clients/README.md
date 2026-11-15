# tools/clients

The check that the three clients agree: one call made by a script (`clients/sdk`), by the `decks`
command and through the MCP relay gives the same answer and the same refusal, against Keel's kernel.
Lexicon owns it.

## Owns

- `same.ts`: `byScript`, `byCommand` and `byMcp`, each making one call and answering `{ value }` or
  `{ refusal: { code, message, hint } }`.
- `same.test.ts`: the check, through Keel's real doors (`testServer().listen()`) with a small probe
  feature: calls, refusals, a token never given, an event on the socket, and `decks login`.
- `attach.test.ts`: `decks attach` against Decks-local's real features; the agent calls as itself, makes
  a card, and `decks detach` leaves the folder as it was.
- `extension-pairs.ts`: the real Chrome extension (`clients/extension`, loaded unpacked in Chromium) pairs
  with `server/tab` and shares a tab that `tab.status` and `tab.read` see. A browser job, not a unit test:
  `node tools/heavy.mjs --wait --class check -- node --import tsx tools/clients/extension-pairs.ts`.
- `try.ts`: stop 2 in one command, `node tools/clients/try.ts [--tool claude] [--deck d]`: Decks-local on
  a copy of the fixture deck, the tool attached in `.scratch/Lexicon/try/`; Ctrl-C detaches and stops.

## May import

Anything in the repo, as all of `tools/` may: the clients, the protocol, and Keel's testing module.

## Rules

1. Every case is made all three ways and the three answers must be equal, refusals included.
2. The command and the relay run as separate processes, as an agent runs them.
3. The tests use Keel's real doors; a few lines of HTTP stand in only where a kernel has none.
4. Ports 4600 to 4609 only.

## Check

`node --import tsx --test tools/clients/*.test.ts`, or `node tools/check.mjs tools`.
