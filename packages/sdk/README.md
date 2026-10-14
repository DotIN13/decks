# @decks/sdk

Control Decks from a program that is not an agent: an app, an MCP server, a script. You get the
same `stage` an agent has (`runtime/stage.d.ts`), typed, over one HTTP endpoint. One file, no
dependencies, Node 18+ or a browser.

```js
import { connect } from "@decks/sdk";

const decks = connect(); // reads DECKS_STAGE_URL and DECKS_STAGE_TOKEN

await decks.stage.boards();                              // any stage verb
await decks.stage.show("boards/report.html", { at: { x1: 0, y1: 0 } });
await decks.sendTo({ name: "Labeler", kind: "claude" }, "Label doc-7"); // made if missing
await decks.run("return (await stage.agents()).length");                // or your own stage code
```

## Where the connection comes from

| Caller | How it connects |
| --- | --- |
| A Decks **server app** | Decks sets `DECKS_STAGE_URL`, `DECKS_STAGE_TOKEN` and `DECKS_SDK` (this file's path): `const { decks } = await import(process.env.DECKS_SDK)` |
| A Decks **app page** | `import { decks } from "../../api/sdk/decks.mjs"`; it finds its app's endpoint from the page address and needs no token |
| An **MCP server** | Run it as a server app; `examples/mcp-server.mjs` serves `decks_eval`, `decks_boards` and `decks_send` at `/app/<name>/mcp` |
| A runtime's tool (opencode, antigravity) | `connect({ url, token, sessionID })` against `/api/stage/eval` |

The first call from an app makes Decks ask the person whether that app may run stage code: once,
or always. Every run is noted in the chat the person is reading.

## What to know

- A call on `decks.stage` is turned into stage code with its arguments written in as JSON, so
  arguments and results must be JSON. Verbs that take a function cannot be called this way.
- A run is cut off after 20 seconds, so hand long work to an agent with `send` and read what it
  writes. `send` returns at once.
- Failures are a `DecksError` with `message`, `status`, the run's `logs` and `timedOut`.
- The types in `src/stage.d.ts` are copied from `runtime/stage.d.ts` by `scripts/sdk-types.mjs`;
  a test fails when they drift. Run `npm test` here for the SDK's own tests.
