# server/kernel

The kernel: the deck, history, callers, the router, events, features and the three doors. It names
no feature; only `server/main.ts` does. Keel owns it.

## Owns

- `types.ts`: the interfaces features build on. They only grow; each addition is announced.
- `deck.ts` (the deck on a folder), `memory-deck.ts` (in memory), `history.ts` (every write a
  revision), `disk.ts` and `store.ts` (a feature's private store), `callers.ts` (tokens to callers).
- `router.ts`, `events.ts`, `kernel.ts` (builds it all), `own-calls.ts` (`deck.*`, its one feature).
- `doors/`: `http.ts`, `socket.ts`, `ws.ts`, `mcp.ts`. `lockfile.ts`, `server.ts` (`startServer`).
- `testing.ts`: `testServer` and `testContext`, for every feature's tests. `index.ts`: the entry.

## May import

`protocol/` through its entry, and node's own modules. Never a feature.

## Rules

1. Only `deck.ts`, `disk.ts` and `lockfile.ts` touch `node:fs`; everything else reads a deck through `Deck`.
2. A path is a `DeckPath`, checked once by `toDeckPath`; a symlink that leads out is refused as `invalid`.
3. Every write, remove and move is a revision in history, with who and when; a file is readable and
   restorable at any revision. A remove goes to `.decks/trash/`. A change made on the disk is `by: "disk"`.
4. A token or a pass (a token issued to a card or an app) becomes a `Caller` at the door. Nothing else
   says who is calling. Only hashes are kept. The person on this machine has id `person`.
5. The router finds the call, checks the caller's kind, checks the arguments, runs the handler, and
   answers in the envelope. Codes: `invalid`, `not_found` (no such call), `refused` (not allowed),
   `conflict`, `unavailable` (declared but unhandled, or answered by the harness).
6. One event stream. A feature hears all; a door's listener hears what its caller may see: person-only
   events go to the person, a card hears only its own canvas.
7. HTTP: `POST /api/v1/<name>`, the bearer token, 200 for every envelope; 401 with no token; 403 for a
   browser Origin with no token. Socket: hello first. MCP: JSON-RPC at `POST /mcp`.
8. A running server keeps `<deck>/.decks/server.json`, mode 0600, with the person's token. A second
   server on the same deck, or the same port, fails with a sentence.

## Not here

Serving the harness's page, upgrading old decks and old call names: later, in `upgrade/` and `compat/`.
No CORS: a page in a browser calls from the server's own address.

## Check

```
node tools/check.mjs server
node --import tsx --test server/kernel/*.test.ts server/kernel/doors/*.test.ts
```
