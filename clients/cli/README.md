# clients/cli

The `decks` command: `decks <noun> <verb>` for every call of the protocol, and `help`, `events`, `login`,
`logout`, `serve`, `attach` and `detach`. Entry: `node clients/cli/main.ts`.

## Owns

- `index.ts`: `run(argv, io)`, the whole command. `main.ts`: the entry a shell runs.
- `args.ts`: a command line's words as one call's arguments.
- `help.ts`: `decks help`, read from `dist-gen/cli/help.txt`, which the generators write.
- `login.ts`, `tokens.ts`: `decks login [code]` and `decks logout`, kept in `~/.decks/tokens.json`.

## May import

`protocol/` and `clients/sdk` through their entries; `clients/attach` for attach and detach. `serve` runs
`server/main.ts` as a separate process; it never imports it.

## Rules

1. A plain argument (a string, a number, a list of strings) is a word, in the order the call declares
   it; `canvas` and `frame` are flags, except where the canvas is the thing itself (`decks view goto
   plan`). Every other key is `--key value`, and `--key.sub value` goes inside it; a key the call does not
   take goes into its first object argument that does (`decks item insert --type card --card p`). A value
   that is not plain is JSON; `-` reads stdin; `--args '<JSON>'` gives all.
2. The value goes to stdout, a string as it is and anything else as JSON. Notes go to stderr.
3. A refusal goes to stderr as `decks: <sentence> (<code>)` and the hint as `try: decks <noun> <verb>`;
   the command exits 1.
4. Who is calling and where is the SDK's rule: `DECKS_URL`, `DECKS_TOKEN`, a token `decks login` kept,
   or the deck's lock file.

## Check

`node tools/check.mjs clients/cli`
