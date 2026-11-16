# Later: what the frame's move to the protocol leaves for after

Improvements found while the canvas frame moved from compat's line to the protocol's socket, kept for
later on purpose: the move changes what the frame speaks, not how it recovers.

## An edit in flight at a drop

Today (as on the old line): an edit sent just before the socket drops is answered `unavailable`, the
frame drops it from its pending queue and reads the drawing whole, which empties the person's undo
and redo (`canvas/host/inside/options.ts`, `document.send`; `canvas/drawing/edits.ts`).

Better: on `unavailable` only, keep the edit shown and wait for the reconnect's catch-up
(`watch { canvas, since }`, which replays every revision after the one held with its `made`). If the
edit landed, its revision names it in `made` and it settles as any other; if it did not land, nothing
names it, and after `PENDING_MS` it goes as it does today. It is never doubled either way.

What it takes: `document.send` tells a refusal (`!answer.ok`) apart from a dropped socket (the
envelope's `code: "unavailable"`, which `backend.act` would have to pass on beside the message), and
reads whole only for the first; a test on the fake socket (`canvas/host/inside/backend.test.ts`) that
an edit in flight at a drop, replayed after it, keeps the person's undo. Found by Reader on step 2.

## For Loft: what decks-studio changes to follow, after step 7

Read on decks-studio branch `rewrite` (f574491, DECKS_COMMIT ae7a437f) against decks-dev `rewrite` after
step 7. Its page still points at the old layout by `file:` paths.

Paths (`page/package.json`, and the root `package.json` for `@decks/pen`):

| Package | Was | Now |
|---|---|---|
| `@decks/canvas` | `decks-dev/packages/canvas` | `decks-dev/canvas` |
| `@decks/pen` | `decks-dev/packages/pen` | `decks-dev/pen` |
| `@decks/ui` | `decks-dev/packages/ui` | `decks-dev/ui` (entries `.`, `./float`) |
| `@decks/sdk` | `decks-dev/packages/sdk` | `decks-dev/clients/sdk` |
| `@decks/protocol` | `decks-dev/packages/protocol` | `decks-dev/protocol` (the new one; the old is `@decks/protocol-old`, which goes) |
| `@decks/hub` | `decks-dev/packages/hub` | drop: the page needs only the follower |
| `@decks/stage` | `decks-dev/packages/stage` | drop: gone, and the page imports nothing from it |
| `@decks/agent-ui` | `decks-dev/packages/agent-ui` | gone (487bbca2); see below |

Imports:

- decks-studio's page/src/routes/canvas/engine-actions.ts and state.ts: `@decks/hub/follower` becomes
  `@decks/canvas/follower` (also exported from `@decks/canvas/host`). Same class, same `FollowerHost`; its
  types now come from `@decks/protocol` (`Changes`, `LiveEvent`).
- `@decks/protocol` (decks-studio's chat-panel.tsx, harness.ts, alerts.tsx and transcripts.ts): `AgentKind`,
  `AgentState`, `AgentMode`, `ModelOption`, `SlashCommand`, `ThinkingLevel`, `THINKING_LEVELS` and
  `ChatItem` are all in the new `@decks/protocol` under those names.
- `@decks/agent-ui/composer`, `/chat`, `/alerts` (4, 2 and 2 imports): the composer and chat moved into
  `harness/page` (Scribe, wave 2), which exports only its page. Studio needs either an entry there for
  them (Scribe's to add) or its own copy. Not settled by step 7.
- `@decks/canvas`, `/comments`, `/tools`, `/camera`, `/host` (`InkBar`, `PenBar`): unchanged names.

The line it still hears: the canvas frame inside Studio uses `canvas/host/inside/studio-line.ts`, not the
protocol's socket. It reads `GET /api/canvases/:id` and `changes?since=`, sends `POST /api/canvases/:id/edits`,
and holds Studio's `/live` socket on the frame token (`frame-token`), saying `presence` and hearing Studio's
`LiveEvent`s and `presence.changed`. That `presence.changed` is still typed from `@decks/protocol-old`'s
`ServerMessage`, so Studio's server keeps saying that shape until the line moves onto `protocol/sync.ts`.
