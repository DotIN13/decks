# Compatibility layers, and when each goes

Code kept so a client of the release before still works. Each layer here names the client it
serves, the test that proves the alias still answers, and the condition for removing it. A layer
with no date is a layer that stays; this file is the date. Strike a line when its layer is deleted,
and add one when a rename leaves an alias behind.

| layer | lines | serves | proven by | goes when |
|---|---|---|---|---|
| `apps/server/src/routes/agents.ts` (`/api/agents/:id/history`, `/earlier`, `/tool/:item`, `/dialogs`, `/settings`, `/:act`), `routes/harness.ts` (`/api/harness`), `GET /api/deck`, `/api/google/status`, `/code`, `/signout`, `/api/apps/:name/seen` and `/restart`: each runs the person's verb and answers the shape the route always answered | ~250 | Decks Studio (`apps/web/src/harness.ts` in its `cards` branch calls `GET /api/agents/:id/settings`, `POST /api/agents/:id/queue`, `POST /api/agents/:id/:act`), and a page of the release before | `apps/server/src/verbs/router.test.ts` (the routes answering as aliases); in a browser, `agents-tab`, `chat-content` | Studio calls the verbs on `/api/v1`: its branch `match-decks-reorg` (2026-11-02) does, for every helper that used these routes; the aliases go once that branch is Studio's release and a page of the release before is not expected (`docs/STUDIO-MIGRATION.md`) |
| `apps/server/src/verbs/renamed.ts`: the verbs removed with boards (2026-10-30), each with the call that does its work now, to word the refusal of an old name | 46 | an agent whose skill file or memory still says `board.list`, `newBoard`, `pen.edit`, … | `apps/server/src/verbs/router.test.ts` | the runtimes' skills have been regenerated on every install that matters, a release after 2026-10-30; it runs nothing, so it may also simply stay |
| `@decks/pen` `OLD_CARD` beside `CARD`: the item type a drawing of the board era used for a card | | a `.pen` file written before 2026-10-30 that no migration has rewritten (a friend's shared canvas is never rewritten) | nothing yet: `packages/pen/src/layout.ts` reads it and no test holds a drawing that says it | never, while a shared canvas may hold one: this one is a file format, not a wire |

The rule, for `CONTRIBUTING.md`: a layer kept "for one release" names the release here, the client
and the check, in the same commit that adds it.

## Gone

- 2026-11-16: the tab socket (`/ws`), its old requests as aliases, the events' old names and the per-agent `stage.pen` copies of a canvas's change. The Decks iOS app and the browser checks talk on the line (`/api/v1/socket`), as the page does.
