# The switch-over, planned

Written by `node tools/switch/run.mjs --dry` on 2026-11-15 from the tree as it is. Nothing in any deck is touched; "apps" means the repo's apps/ source folder.

## Deleted

- `apps/server` (@decks/server): now server/ (Decks-local) and harness/ (agents). Proof: node tools/check.mjs server, node tools/check.mjs harness; the 76 browser checks of stop 3.
- `apps/web` (@decks/web): now harness/page. Proof: the page checks of stop 3 (shell, panel, chrome, agents-tab, ...).
- `packages/agent-ui` (@decks/agent-ui): now harness/page (chat/, composer/). Proof: chat-content, slash, voice, working-marks checks.
- `packages/sdk` (@decks/sdk): now clients/sdk, clients/cli. Proof: node tools/check.mjs clients/sdk, tools/clients/same.test.ts.
- `runtime` (@decks/runtime): now harness/prompts, harness/runtimes. Proof: node tools/check.mjs harness; running, time-machine checks.
- `extension`: already moved to clients/extension.

### Not deleted, and why

- `packages/sync-protocol`: **not deleted**, still imported by 8 file(s) that stay: packages/hub/src/commit.ts, packages/hub/src/follower.ts, packages/hub/src/handlers.ts, packages/hub/src/layout.ts, .... Its new home: protocol/sync.ts.
- `packages/sync-client`: **not deleted**, still imported by 1 file(s) that stay: packages/hub/test/share-site.test.ts. Its new home: server/sharing/client.
- `packages/docs`: its server half lives in server/documents, its page half is Loom's; the package goes whole with Loom.

## Kept until Loom moves them (wave 3)

Decided in DESIGN.md section 11; they go at the map's step 4a.

- `packages/canvas`
- `packages/card-host`
- `packages/ink`
- `packages/docs`
- `packages/pen`
- `packages/ui`
- `packages/stage`
- `packages/protocol`: the canvas library reads its old shapes (Page, Presence, StageCall, ...)
- `packages/api`: the canvas library's card calls (cardCalls)
- `packages/hub`: the canvas library's follower (studio-line.ts)

## Renamed

After the deletions, so no new name meets an old package's:

- `@decks-next/attach` to `@decks/attach` (clients/attach): 1 file(s) name it
- `@decks-next/cli` to `@decks/cli` (clients/cli): 1 file(s) name it
- `@decks-next/extension` to `@decks/extension` (clients/extension): 1 file(s) name it
- `@decks-next/mcp` to `@decks/mcp` (clients/mcp): 1 file(s) name it
- `@decks-next/sdk` to `@decks/sdk` (clients/sdk): 19 file(s) name it
- `@decks-next/harness` to `@decks/harness` (harness): 2 file(s) name it
- `@decks-next/page` to `@decks/page` (harness/page): 1 file(s) name it
- `@decks-next/protocol` to `@decks/protocol` (protocol): 62 file(s) name it
- `@decks-next/server` to `@decks/server` (server): 1 file(s) name it
- `@decks-next/tools` to `@decks/tools` (tools): 1 file(s) name it

Then one install under the heavy lock, so node_modules links the new names.

## Moved

The 76 browser checks of stop 3, each to its owner's feature (owners from the stop 3 card's runs.json; with none, by what it exercises: the page's to Pane, the canvas library's to tools/checks/canvas until Loom moves the library):

- `server/cards/checks/` (7): empty-canvas-follows, board-links, placement, card-ground, card-tab, card-links, deck-imports
- `harness/page/checks/` (17): panel (by subject: Pane), chat-content (by subject: Pane), slash (by subject: Pane), notifications (by subject: Pane), agents-tab, shell (by subject: Pane), focus, placement-views, context (by subject: Pane), per-agent (by subject: Pane), working-marks (by subject: Pane), panel-steady (by subject: Pane), item-pill, voice (by subject: Pane), canvas-switch (by subject: Pane), stages (by subject: Pane), new-agent-opens (by subject: Pane)
- `server/people/checks/` (6): tiers, news-seen, old-board (by subject: Roster), view-calls, presence, agent-cursor
- `server/canvas/checks/` (8): geometry, board-comment, pen-stage, card-editor, stage-gestures, shapes, same-drawing, frames
- `tools/checks/canvas/` (24): selection (by subject: Loom), camera (by subject: Loom), layers-webkit (by subject: Loom), placement-at (by subject: Loom), glide (by subject: Loom), stage-scroll (by subject: Loom), card-phone (by subject: Loom), bent-arrows (by subject: Loom), engine-slide (by subject: Loom), zoom-out-pictures (by subject: Loom), opening-lands (by subject: Loom), wheel-diagonal (by subject: Loom), backends (by subject: Loom), context-loss (by subject: Loom), note-edges (by subject: Loom), tile-pixels (by subject: Loom), stage-goldens (by subject: Loom), drop-lands (by subject: Loom), canvas-frame (by subject: Loom), pencil-then-finger (by subject: Loom), media (by subject: Loom), camera-roundtrip (by subject: Loom), card-copy (by subject: Loom), card-keys (by subject: Loom)
- `tools/checks/e2e/` (6): items-made, card-shot, stage-shot, placeholder, ink-long-stroke, smooth-edits
- `server/pictures/checks/` (8): apps-in-frame, card-fit, one-picture, export, export-pill, awake, card-frame, card-files-img

`e2e/harness.mjs` becomes `tools/checks/harness.mjs`; each moved check's `../harness.mjs` import is rewritten to it, and nothing else in a check changes. `e2e/run.mjs` is replaced by `tools/checks/run.mjs`, which finds checks in their new places. The fixture moves from `e2e/fixture` to `tools/fixtures/deck` (already there).

### Not in stop 3 (19): they stay in e2e/checks with today's e2e/run.mjs, for their owners to keep or drop

agent-rows, arrow-label, arrows-steady, awake-bench, awake-drag, card-frame-demo, card-frame-drag, cards-smoke, chrome, edits-wait, look-shots, nudge, pan-heavy, render-perf, running, stage-api, text-shots, time-machine, walkthrough

## Compat

Every old name answers until 2027-05-14. After the switch, today's canvas library (kept until Loom), the page's compat mode and the moved checks still speak 43 of the 121 renamed names; those stay, and Studio and the iPad app may speak any of them until the date. 78 are spoken by nothing in this repo; they could go now, but stay until 2027-05-14 for Studio and the iPad app, which are not in this repo:

- `pair.code` (call) -> `deck.pair`
- `harness.revoke` (call) -> `deck.revoke`
- `harness.configure` (call) -> `deck.update`
- `canvas.copyShared` (call) -> `canvas.copy`
- `canvas.remove` (call) -> `canvas.delete`
- `canvas.rename` (call) -> `canvas.update`
- `canvas.edit` (call) -> `item.batch`
- `doc.place` (call) -> `item.insert`
- `canvas.replace` (call) -> `item.replace`
- `canvas.space` (call) -> `item.space`
- `canvas.variables` (call) -> `item.variables`
- `agent.claim` (call) -> `card.claim`
- `card.canvases` (call) -> `card.get`
- `card.delete` (call) -> `file.delete`
- `canvas.save` (call) -> `frame.save`
- `apps.build` (call) -> `app.build`
- `apps.check` (call) -> `app.check`
- `apps.clone` (call) -> `app.clone`
- `apps.status` (call) -> `app.get`
- `apps.repo` (call) -> `app.get`
- `apps.list` (call) -> `app.list`
- `apps.logs` (call) -> `app.logs`
- `apps.delete` (call) -> `app.delete`
- `apps.restart` (call) -> `app.restart`
- `apps.run` (call) -> `app.run`
- `apps.stop` (call) -> `app.stop`
- `apps.seen` (call) -> `app.update`
- `ports` (call) -> `port.list`
- `agent.add` (call) -> `agent.create`
- `web.answer` (call) -> `tab.answer`
- `web.click` (call) -> `tab.click`
- `web.fill` (call) -> `tab.fill`
- `web.open` (call) -> `tab.open`
- `web.pairing` (call) -> `tab.pair`
- `web.repair` (call) -> `tab.pair`
- `web.press` (call) -> `tab.press`
- `web.read` (call) -> `tab.read`
- `web.screenshot` (call) -> `tab.screenshot`
- `web.select` (call) -> `tab.select`
- `web.status` (call) -> `tab.status`
- `web.stop` (call) -> `tab.stop`
- `web.submit` (call) -> `tab.submit`
- `harness.unpair` (call) -> `studio.disconnect`
- `account.googleCode` (call) -> `google.connect`
- `account.googleSignOut` (call) -> `google.disconnect`
- `account.google` (call) -> `google.status`
- `agent.answer` (call) -> `chat.answer`
- `chat.tool` (call) -> `chat.get`
- `chat.open` (call) -> `chat.list`
- `chat.earlier` (call) -> `chat.list`
- `agent.reset` (call) -> `chat.delete`
- `account.add` (call) -> `account.create`
- `account.forget` (call) -> `account.delete`
- `agent.dialogs` (call) -> `runtime.get`
- `agent.settings` (call) -> `runtime.get`
- `harness.get` (call) -> `runtime.get`
- `harness.settings` (event) -> `deck.changed`
- `harness.paired` (event) -> `deck.changed`
- `doc.created` (event) -> `file.created`
- `doc.state` (event) -> `file.changed`
- `doc.changed` (event) -> `file.changed`
- `doc.patched` (event) -> `file.changed`
- `doc.versions` (event) -> `file.changed`
- `doc.version` (event) -> `file.changed`
- `doc.compiled` (event) -> `file.changed`
- `doc.repo` (event) -> `file.changed`
- `doc.remote` (event) -> `file.changed`
- `doc.gdoc` (event) -> `file.changed`
- `doc.gcomments` (event) -> `file.changed`
- `agent.context` (event) -> `agent.changed`
- `agent.removed` (event) -> `agent.deleted`
- `web.changed` (event) -> `tab.changed`
- `agent.queued` (event) -> `chat.changed`
- `chat.draft` (event) -> `chat.drafted`
- `agent.account` (event) -> `account.changed`
- `harness.runtimes` (event) -> `runtime.changed`
- `harness.notice` (event) -> `runtime.noticed`
- `harness.error` (event) -> `runtime.noticed`

## Root files

- Workspaces: `packages/*`, `apps/*`, `e2e`, `examples/*`, `protocol`, `server`, `harness`, `harness/page`, `clients/*`, `tools`.
- Scripts: `dev`: `node --import tsx server/main.ts --deck "${DECKS_DECK:-$PWD/data}" & node --import tsx harness/main.ts --deck "${DECKS_DECK:-$PWD/data}"`; `start`: `node --import tsx server/main.ts --deck "${DECKS_DECK:-$PWD/data}"`; `build:page`: `npm run build --workspace @decks/page`; `typecheck`: `npm run typecheck --workspaces --if-present`; `test`: `node tools/check.mjs protocol && node tools/check.mjs server && node tools/check.mjs harness && node tools/check.mjs tools`; `gates`: `node tools/gates/run.mjs`; `test:e2e`: `node tools/checks/run.mjs`; `check`: `node tools/check.mjs`; `heavy`: `node tools/heavy.mjs`.
- Scripts removed: `dev:server`, `dev:web`, `e2e:serve`, `e2e:serve:server`, `build`, `vendor`, `build:live-doc`, `css:order`, `gates:next`, `dev:example`, `build:packages`, `test:packages`.
- CI: .github/workflows/test.yml: npm run test:e2e runs tools/checks/run.mjs; the typecheck and test steps stay.

## Order, one commit each, the gates passing after each

The commits touch other lanes' folders (the moved checks, the deleted code): Mason opens those paths to Warden for the switch, or commits them.

1. Move the 76 checks and the harness into place; run.mjs finds them there.
2. Delete what has a new home and no importer left.
3. Rename @decks-next to @decks, then install.
4. Root files and CI.
5. Shrink the gate baselines.
