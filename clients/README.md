# clients

The ways in from outside: everything that calls a Decks server and is not the server. Lexicon owns it.

## Owns

- `sdk/`: the typed client, `connect()`, every call, the event stream. The others are built on it.
- `cli/`: the `decks` command.
- `mcp/`: the MCP relay over stdio, for a client with no shell.
- `attach/`: `decks attach` and `decks detach`, which set up Claude Code, Codex or opencode.

## May import

`protocol/` through its entry, and `clients/sdk` through its entry (or its `./testing` export in tests).
Nothing of `server/` or `harness/`.

## Rules

1. Every call is the protocol's: nothing here lists calls by hand.
2. A call travels as `protocol/wire.ts` says, and a refusal reaches the caller with its code, sentence
   and hint, through every client.
3. Each client is its own project: `package.json` and `tsconfig.json` as `tools/README.md` says.

## Check

`node tools/check.mjs clients/<name>` for sdk, cli, mcp and attach.
