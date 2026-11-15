# The switch-over, planned

Written by `node tools/switch/run.mjs --dry` on 2026-11-15 from the tree as it is. Nothing in any deck is touched; "apps" means the repo's apps/ source folder.

## Deleted

- `apps/server` (@decks/server): now server/ (Decks-local) and harness/ (agents). Proof: node tools/check.mjs server, node tools/check.mjs harness; the 76 browser checks of stop 3.
- `apps/web` (@decks/web): now harness/page. Proof: the page checks of stop 3 (shell, panel, chrome, agents-tab, ...).
- `packages/agent-ui` (@decks/agent-ui): now harness/page (chat/, composer/). Proof: chat-content, slash, voice, working-marks checks.
- `packages/sdk` (@decks/sdk): now clients/sdk, clients/cli. Proof: node tools/check.mjs clients/sdk, tools/clients/same.test.ts.
- `runtime` (@decks/runtime): now harness/prompts, harness/runtimes. Proof: node tools/check.mjs harness; running, time-machine checks. **Except `runtime/live-doc.ts`, kept where it is:** the source of packages/card-host/lib/live-doc.js, built by scripts/live-doc.mjs; Loom's step 4d moves it into canvas/.
- `e2e` (@decks/e2e): now tools/checks (the runner, the harness, the fake model and agent) and the features' checks/ folders. Proof: every check moved first and started by node tools/checks/run.mjs.
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
- `packages/protocol`: the canvas library reads its old shapes (Page, Presence and the old call and author types)
- `packages/api`: the canvas library's card calls (cardCalls)
- `packages/hub`: the canvas library's follower (studio-line.ts)
- `scripts/vendor.mjs`: fills packages/card-host/lib (Loom's step 4c moves it)
- `scripts/live-doc.mjs`: builds lib/live-doc.js from runtime/live-doc.ts (Loom's step 4d moves it)
- `runtime/live-doc.ts`: see Deleted

## Renamed

After the deletions, so no new name meets a deleted package's:

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

Two workspaces cannot share a name:

- `packages/protocol` (`@decks/protocol`) is a kept package whose name a new one takes: first it becomes `@decks/protocol-old` until Loom moves it (map step 4a), and its 42 importers get that specifier, nothing else in them changed: packages/canvas/package.json, packages/canvas/src/camera/agent-view.test.ts, packages/canvas/src/camera/agent-view.ts, packages/canvas/src/camera/agent-views.ts, packages/canvas/src/camera/camera.ts, packages/canvas/src/camera/controller.ts, packages/canvas/src/camera/land.ts, packages/canvas/src/camera/landing.test.ts, packages/canvas/src/camera/landing.ts, packages/canvas/src/camera/scroll-area.ts, packages/canvas/src/camera/stage-ops.test.ts, packages/canvas/src/camera/stage-ops.ts, packages/canvas/src/editor.tsx, packages/canvas/src/frame/chrome.ts, packages/canvas/src/frame/inside/backend.ts, packages/canvas/src/frame/inside/boot.ts, packages/canvas/src/frame/inside/card-calls.ts, packages/canvas/src/frame/inside/events.ts, packages/canvas/src/frame/inside/line.ts, packages/canvas/src/frame/inside/options.ts, packages/canvas/src/frame/inside/presence.ts, packages/canvas/src/frame/inside/studio-line.ts, packages/canvas/src/frame/outside/host.tsx, packages/canvas/src/frame/protocol.ts, packages/canvas/src/ink/StageInk.tsx, packages/canvas/src/items/awake.ts, packages/canvas/src/items/item-slot.tsx, packages/canvas/src/items/news.test.ts, packages/canvas/src/items/news.ts, packages/canvas/src/model/drawing.ts, packages/canvas/src/public/camera.ts, packages/canvas/src/render/engine.ts, packages/canvas/src/stage/Stage.tsx, packages/canvas/src/stage/input.ts, packages/canvas/src/stage/items-layer.tsx, packages/canvas/src/stage/selection.tsx, packages/canvas/src/types.ts, packages/canvas/src/ui/Callout.tsx, packages/protocol/package.json, packages/ui/package.json, packages/ui/src/agent-marks.tsx, scripts/public-entries.test.mjs

Then one install under the heavy lock, so node_modules links the new names.

## Moved

All 95 browser checks move and start under `node tools/checks/run.mjs`; `e2e/run.mjs` goes with e2e/. Stop 3's go to their owners' features (owners from the stop 3 card's runs.json; with none, by what they exercise: the page's to Pane, the canvas library's to tools/checks/canvas until Loom moves the library); the agent checks to tools/checks/agent, the benches to tools/checks/bench:

- `server/cards/checks/` (7): empty-canvas-follows, board-links, placement, card-ground, card-tab, card-links, deck-imports
- `harness/page/checks/` (18): panel (by subject: Pane), chat-content (by subject: Pane), slash (by subject: Pane), notifications (by subject: Pane), agents-tab, shell (by subject: Pane), focus, placement-views, context (by subject: Pane), per-agent (by subject: Pane), working-marks (by subject: Pane), panel-steady (by subject: Pane), card-shot, item-pill, voice (by subject: Pane), canvas-switch (by subject: Pane), stages (by subject: Pane), new-agent-opens (by subject: Pane)
- `server/people/checks/` (6): tiers, news-seen, old-board (by subject: Roster), view-calls, presence, agent-cursor
- `server/canvas/checks/` (8): geometry, board-comment, pen-stage, card-editor, stage-gestures, shapes, same-drawing, frames
- `tools/checks/canvas/` (34): selection (by subject: Loom), camera (by subject: Loom), layers-webkit (by subject: Loom), placement-at (by subject: Loom), glide (by subject: Loom), stage-scroll (by subject: Loom), card-phone (by subject: Loom), bent-arrows (by subject: Loom, timed), engine-slide (by subject: Loom), zoom-out-pictures (by subject: Loom), opening-lands (by subject: Loom), wheel-diagonal (by subject: Loom), backends (by subject: Loom), context-loss (by subject: Loom), note-edges (by subject: Loom), tile-pixels (by subject: Loom), stage-goldens (by subject: Loom), drop-lands (by subject: Loom), canvas-frame (by subject: Loom), pencil-then-finger (by subject: Loom), media (by subject: Loom), camera-roundtrip (by subject: Loom), card-copy (by subject: Loom), card-keys (by subject: Loom), arrow-label (not in stop 3, named), arrows-steady (not in stop 3, named), awake-drag (not in stop 3, named), card-frame-demo (not in stop 3, named), card-frame-drag (not in stop 3, named), cards-smoke (not in stop 3), edits-wait (not in stop 3, named), look-shots (not in stop 3, named), nudge (not in stop 3, named), text-shots (not in stop 3, named)
- `tools/checks/e2e/` (5): items-made, stage-shot, placeholder, ink-long-stroke (timed), smooth-edits (timed)
- `server/pictures/checks/` (8): apps-in-frame, card-fit, one-picture, export, export-pill, awake, card-frame, card-files-img
- `tools/checks/agent/` (6): agent-rows (not in stop 3), chrome (not in stop 3), running (not in stop 3), stage-api (not in stop 3), time-machine (not in stop 3), walkthrough (not in stop 3)
- `tools/checks/bench/` (3): awake-bench (not in stop 3, named), pan-heavy (not in stop 3, named), render-perf (not in stop 3, named)

What the runner must know of a check is a field in `tools/checks/checks.json`: `timed` runs alone on the dev server, as it was written for (DESIGN.md section 11), every other check on the built page; `agent` is skipped unless `--agent`; `named` and `bench` for the long checks and the measures; `path` where it lives. `e2e/harness.mjs` becomes `tools/checks/harness.mjs` and each moved check's `../` imports point there; the fake model and agent move to tools/checks; the fixture is `tools/fixtures/deck` (already there).

### The agent checks, once on the new programs before the deletions

agent-rows, chrome, running, time-machine, walkthrough: each starts an agent's turn through Pi with the fake model (`fake-agent`, `fake-model.mjs` on port 4700), which the runner starts; no signed-in Claude, no tokens. Run on 2026-11-14: all pass. stage-api: asks the agent to run the decks command, which the fake model cannot do; it needs a real model. The runner starts the harness with Pi on the fake model only, so that run needs the harness started with a signed-in Claude (`--kinds claude`), once, with Mason's yes.

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

- Workspaces: `packages/*`, `apps/*`, `examples/*`, `protocol`, `server`, `harness`, `harness/page`, `clients/*`, `tools`.
- Kept until Loom moves the packages that use them: `vendor` (copies d3, KaTeX, pdf.js and the bundles into packages/card-host/lib); `build:live-doc` (builds packages/card-host/lib/live-doc.js); `build:packages` (builds the public @decks packages (canvas, pen, ui, the engine, card-host, hub) for Studio and npm); `test:packages` (packs and installs those packages to prove they run outside the repo).
- Scripts: `dev`: `node --import tsx server/main.ts --deck "${DECKS_DECK:-$PWD/data}" & node --import tsx harness/main.ts --deck "${DECKS_DECK:-$PWD/data}"`; `start`: `node --import tsx server/main.ts --deck "${DECKS_DECK:-$PWD/data}"`; `build:page`: `npm run build --workspace @decks/page`; `typecheck`: `npm run typecheck --workspaces --if-present`; `test`: `node tools/check.mjs protocol && node tools/check.mjs server && node tools/check.mjs harness && node tools/check.mjs tools`; `gates`: `node tools/gates/run.mjs`; `test:e2e`: `node tools/checks/run.mjs`; `check`: `node tools/check.mjs`; `heavy`: `node tools/heavy.mjs`; `vendor`: `node scripts/vendor.mjs`; `build:live-doc`: `node scripts/live-doc.mjs`; `build:packages`: `node scripts/build-packages.mjs`; `test:packages`: `node scripts/test-packages.mjs`.
- Scripts removed: `dev:server`, `dev:web`, `e2e:serve`, `e2e:serve:server`, `build`, `css:order`, `gates:next`, `dev:example`.
- CI: .github/workflows/test.yml: npm run test:e2e runs tools/checks/run.mjs; the typecheck and test steps stay.

## Lanes the switch needs, for that one job

- 1. moving the checks: `e2e/`, `harness/page/checks/`, `server/canvas/checks/`, `server/cards/checks/`, `server/people/checks/`, `server/pictures/checks/`, `tools/checks/`
- 2. deleting: `apps/server/`, `apps/web/`, `packages/agent-ui/`, `packages/sdk/`, `runtime/`, `e2e/`
- 3. renaming (files that name @decks-next): `clients/attach/`, `clients/cli/`, `clients/extension/`, `clients/mcp/`, `clients/sdk/`, `docs/`, `harness/`, `protocol/`, `server/package.json`, `tools/`
- 4. root files and CI: `package.json`, `package-lock.json`, `.github/workflows/`

## Order, one commit each, the gates passing after each

The commits touch other lanes' folders: Mason opens the paths listed above to Warden for the switch.

1. Move every check, the harness and the fake model and agent into place; run.mjs finds them by checks.json.
2. Delete what has a new home and no importer left.
3. Rename @decks-next to @decks, then install.
4. Root files and CI.
5. Shrink the gate baselines.
