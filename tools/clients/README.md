# tools/clients

The check that the three clients agree: one call made by a script (`clients/sdk`), by the `decks`
command and through the MCP relay gives the same answer and the same refusal, against Keel's kernel.
Lexicon owns it.

## Owns

- `same.ts`: `byScript`, `byCommand` and `byMcp`, each making one call and answering `{ value }` or
  `{ refusal: { code, message, hint } }`.
- `same.test.ts`: the check, against `server/kernel/testing.ts` with a small probe feature, ports 4600
  to 4609.

## May import

Anything in the repo, as all of `tools/` may: the clients, the protocol, and Keel's testing module.

## Rules

1. Every case is made all three ways and the three answers must be equal, refusals included.
2. The command and the relay run as separate processes, as an agent runs them.
3. Until Keel's doors (`listen`) run, the test puts the router behind a few lines of HTTP; after, it
   uses the real doors.

## Check

`node --import tsx --test tools/clients/same.test.ts`, or `node tools/check.mjs tools`.
