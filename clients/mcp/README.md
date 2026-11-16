# clients/mcp

The MCP relay: JSON-RPC 2.0 over stdio to a running Decks server, for a client with no shell. Entry:
`node clients/mcp/main.ts`.

## Owns

- `index.ts`: `tools(filter)`, `callTool(client, name, input)`, `answer(message, client)`, `serve()`.
- `main.ts`: the entry an MCP client runs.

## May import

`protocol/` and `clients/sdk` through their entries. It reads `dist-gen/mcp/tools.json`, which the
generators write.

## Rules

1. A tool is a server call an agent may make, named as the call (`item.move`); its input is the call's
   arguments. The harness's own calls (chat, account, runtime) are never tools.
2. The list is the generated one; when it is missing the same list is made from the protocol, and a test
   holds the two equal.
3. `DECKS_TOOLS` (`item,card,view.focus`) narrows the list to those nouns or calls.
4. A call's value and notes come back as text; a refusal is an error result: `<sentence> (<code>)` and
   `Try <hint>.`
5. The server and token are the SDK's: `DECKS_URL`, `DECKS_TOKEN`, a token `decks login` kept, or the
   deck's lock file. The first call connects.

## Check

`node tools/check.mjs clients/mcp`
