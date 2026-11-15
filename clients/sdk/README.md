# clients/sdk

`@decks/sdk`: every call, typed from the protocol, over HTTP, and the event stream over the socket.
Runs in node 22 and later and in a browser.

## Owns

- `index.ts`: everything, and `connect({ url?, token?, notes? })`, which finds the server.
- `client.ts`: `clientFor(url, token)`, a `Client` with `call(name, args)`, `events(hear, { events?,
  canvas? })` and `decks.<noun>.<verb>(args)`.
- `browser.ts` (export `./browser`): `clientFor`, `DecksError`, `Line` and the types, with no node module
  behind them, for a page.
- `http.ts`: one call as `POST /api/v1/<name>`; `DecksError`. `socket.ts`: the event stream.
- `find.ts`: where the server is and who is calling, when not told.
- `line.ts`: a socket kept open: calls over it, events, asks answered with one reply, `tell`.
- `host.ts`: `host({ kinds, answers, start, mail })`, the Host line the harness uses: it offers its kinds
  and harness calls with `agent.host` over its socket, answers each ask, and hears `agent.requested` and
  `agent.mailed`. A thrown error with `code`, `message` and `hint` becomes the refusal.
- `testing/fake-server.ts` (export `./testing`): a small server that speaks the wire, a test double for
  the clients' tests. Keel's `testServer().listen()` is the real one.

## May import

`protocol/` through its entry. Node modules only in `find.ts` (loaded when run in node) and `testing/`.

## Rules

1. A typed call's arguments and answer are the protocol's `Args` and `Answer`: no second declaration.
2. A refusal is thrown as `DecksError` with `code`, `message`, `hint` and `notes`. No server is
   `unavailable`. A call's notes go to the `notes` callback.
3. The server is the one given, else `DECKS_URL`, else the lock file (`.decks/server.json`) of
   `DECKS_DECK` or the nearest deck above the working folder.
5. A host's offer lasts while its socket is open; `tell(name, payload)` sends a harness event for the
   server to fan out.
4. The token is the one given, else `DECKS_TOKEN`, else one `decks login` kept for that address in
   `~/.decks/tokens.json`, else the lock file's when it names the same server. It goes only in a header.

## Check

`node tools/check.mjs clients/sdk`
