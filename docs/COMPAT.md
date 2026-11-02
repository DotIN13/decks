# Compatibility layers, and when each goes

Code kept so a client of the release before still works. Each layer here names the client it
serves, the test that proves the alias still answers, and the condition for removing it. A layer
with no date is a layer that stays; this file is the date. Strike a line when its layer is deleted,
and add one when a rename leaves an alias behind.

| layer | lines | serves | proven by | goes when |
|---|---|---|---|---|
| `apps/server/src/wire/legacy.ts`: the tab socket's old `ClientMessage` requests, each run as the person's verb it stands for | 221 | the Decks iOS app, and a page of the release before `one vocabulary` (2026-11) | `apps/server/src/line.test.ts`, `verbs/router.test.ts`; in a browser, `shell`, `panel` | the iOS app calls the verbs on the line (`line.call`). `wire/` is then a directory of nothing and goes with it; `settleStage` (`stage/pending.ts`) moves back beside its callers |
| `packages/protocol/src/names.ts` `OLD_EVENT_NAMES`, and `apps/server/src/ws.ts` saying them to a socket whose `hello` lacks `v: 2` | ~60 | the iOS app, and a page of the release before | `packages/protocol/src/names.test.ts`, `apps/server/src/ws.test.ts` | the iOS app says `v: 2` |
| the per-agent `stage.pen` copies of a canvas's change on the tab socket (`server/src/ws.ts`); the line and the stream say `canvas.changed` | | a page of the release before | `apps/server/src/stage/pens.test.ts` | with the two above |
| `apps/server/src/routes/agents.ts` (`/api/agents/:id/history`, `/earlier`, `/tool/:item`, `/dialogs`, `/settings`, `/:act`), `routes/harness.ts` (`/api/harness`), `GET /api/deck`, `/api/google/status`, `/code`, `/signout`, `/api/apps/:name/seen` and `/restart`: each runs the person's verb and answers the shape the route always answered | ~250 | Decks Studio (`apps/web/src/harness.ts` in its `cards` branch calls `GET /api/agents/:id/settings`, `POST /api/agents/:id/queue`, `POST /api/agents/:id/:act`), and a page of the release before | `apps/server/src/verbs/router.test.ts` (the routes answering as aliases); in a browser, `agents-tab`, `chat-content` | Studio calls the verbs on `/api/v1`: its branch `match-decks-reorg` (2026-11-02) does, for every helper that used these routes; the aliases go once that branch is Studio's release and a page of the release before is not expected (`docs/STUDIO-MIGRATION.md`) |
| `apps/server/src/verbs/renamed.ts`: the verbs removed with boards (2026-10-30), each with the call that does its work now, to word the refusal of an old name | 46 | an agent whose skill file or memory still says `board.list`, `newBoard`, `pen.edit`, … | `apps/server/src/verbs/router.test.ts` | the runtimes' skills have been regenerated on every install that matters, a release after 2026-10-30; it runs nothing, so it may also simply stay |
| `@decks/pen` `OLD_CARD` beside `CARD`: the item type a drawing of the board era used for a card | | a `.pen` file written before 2026-10-30 that no migration has rewritten (a friend's shared canvas is never rewritten) | nothing yet: `packages/pen/src/layout.ts` reads it and no test holds a drawing that says it | never, while a shared canvas may hold one: this one is a file format, not a wire |

The rule, for `CONTRIBUTING.md`: a layer kept "for one release" names the release here, the client
and the check, in the same commit that adds it.
