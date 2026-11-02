# Reorganizing studio-canvas

A design for cleaning up the code on the `studio-canvas` branch: what is dead, what is in the wrong
place, what is too big, and the order to fix it in so every commit stays green. Written 2026-11-02
against commit `34ee017`, the tip after cards and the canvas frame landed. It replaces the design of
the same name written against `235a06b`, which the tree has since outgrown.

Every number here comes from scans of the tracked tree (§7 says how). Every "dead" claim was checked
by name against every tracked `.ts`, `.tsx`, `.mjs`, `.html`, `.json`, `.css` and `.md` file. Where a
scan can be fooled, the entry says so and what to check before deleting.

## 1. Where the branch stands

| | |
|---|---|
| source lines (ts, tsx, mjs, rs, css, wgsl) | ~201,000 across 20 workspaces |
| largest workspaces | `apps/server` 55.3k, `packages/canvas` 39.1k, `apps/web` 31.1k, `packages/stage` 24.2k, `e2e` 18.1k |
| `npm run typecheck` | passes |
| `npm run css:order` | unchanged: 1,895 rules over 21 sheets, 23 ties |
| unit tests run here | canvas 383 (5 skipped), web 134, agent-ui 99, ui 28, pen 76 (1 fails, §3.9), hub 18, api 13, ink 8, protocol 2; the server's need a browser and were not run |
| source files over 1,000 lines | 21, vendored bundles excluded |

Since the last design the branch has done much of the work that design asked for: `_scratch/` is
gone and ignored; `packages/canvas` is grouped into `camera/ edit/ frame/ items/ model/ render/
stage/ ui/`; `Stage.tsx` is down from 2,395 lines to 913; the server's requests and events have one
vocabulary (`@decks/api`, `packages/protocol/src/names.ts`). What is left is of three kinds: the
residue the earlier design already named and nothing has removed (the shims, `v3.css`, the probes);
the residue of the two renames the branch made since (boards became cards, stages became canvases),
which the data and the wire have finished and the code's own names have not; and the compatibility
layers written "for one release", which need a release that removes them.

## 2. The rules this plan follows

From `CONTRIBUTING.md`, and they shape the sequencing in §6:

- **One idea per commit.** A move, a rename and a behaviour change are three commits. Each step
  below is one commit or a short run of them, each passing `npm run typecheck`, `npm test` and
  `npm run css:order`.
- **The cascade is a test.** All 21 sheets declare in `@layer components`, so position decides ties.
  Any CSS move re-stamps `apps/web/src/styles/cascade-order.json` with `npm run css:order --
  --update`, and the diff is read, not skipped.
- **No behaviour change rides along.** Everything here is a rearrangement. Where a step could change
  behaviour (removing a CSS rule, deleting a global a browser check reads), it names the check that
  would catch it.
- **The package's surface is the API.** `@decks/canvas`, `@decks/agent-ui` and `@decks/ui` are "for
  any host" (Decks Studio imports them, §4.6). Their `exports` maps do not change in this plan, and
  nothing moves into their `styles/` that only the Decks app wants.

## 3. Dead code, verified

### 3.1 Twenty-five one-line re-export shims

When the conversation UI, alerts, icons and helpers moved into `@decks/agent-ui` and `@decks/ui`, and
the canvas layout into `@decks/hub`, each old path was left as a one-line `export * from "…"`. A shim
is a second name for one thing; it is only worth keeping while something imports it. Importers were
counted by resolving each relative import to the shim's path, so a target with the same stem does not
inflate the count.

| shim | importers | action |
|---|---|---|
| `apps/web/src/chat/`: `StatusLine.tsx`, `TimeMachine.tsx`, `ToolChip.tsx`, `ToolGroup.tsx`, `Turn.tsx`, `float-rows.ts`, `markdown.ts`, `tool-groups.ts`, `turn-cards.ts`, `working-sign.ts`; `chat/composer/mention.ts` | 0 | delete |
| `agents/agent-marks.tsx`, `alerts/notify.ts`, `alerts/sound.ts`, `chat/Stream.tsx`, `chat/composer/DraftField.tsx` | 1 | repoint the importer, delete |
| `chat/history-page.ts` | 2 | repoint, delete |
| `alerts/policy.ts`, `chat/tool-results.ts` | 3 | repoint, delete |
| `state/edge.ts` | 4 | repoint, delete |
| `lib/time.ts` | 5 | repoint, delete |
| `chat/composer/draft.ts` | 7 | repoint, delete |
| `ui/Popover.tsx` | 13 | repoint, delete |
| `apps/server/src/deck/layout.ts` → `@decks/hub/layout` | 21 | repoint (a `sed`), delete, as its own commit |
| `ui/icons.tsx` → `@decks/ui` | 30 | repoint (a `sed`), delete, as its own commit |

`packages/canvas/src/public/comments.ts` is also two lines, but it is the `@decks/canvas/comments`
entry point: it stays. After this, `apps/web/src/chat/` holds only the composer and `Dialog.tsx`,
`alerts/` only `AlertSettings.tsx`, `ui/` only `ConfirmDialog.tsx`; §4.2 dissolves all three.

A rule for `CONTRIBUTING.md` so this does not recur: **when a module moves, move its importers in
the same commit.** Two names for one rule is how the wrong one wins, in code as in the cascade.

### 3.2 Exports nothing uses

Exported symbols that no file references, not even their own. Verified by `git grep -w`.

- `apps/server/src/auth/issue.ts`: `ELSEWHERE`
- `apps/server/src/deck/loader.ts`: `DeckWarning`
- `apps/server/src/verbs/paste.ts`: `forgetClips`
- `apps/server/src/verbs/person.ts`: `personGesture`
- `apps/web/src/lib/session.ts`: `withToken`
- `apps/web/src/state/agent.ts`: `AgentScratchStore`
- `apps/web/src/state/ui.ts`: `Ui`
- `packages/agent-ui/src/edge.ts`: `inspectorShown`
- `packages/canvas/src/camera/coords.ts`: `FrameAt`
- `packages/canvas/src/edit/core/dispatch.ts`: `DRAG_SLOP_PX`
- `packages/canvas/src/render/icons.ts`: `PenIcons` (a class)
- `packages/canvas/src/render/types.ts`: `PenHit`
- `packages/hub/src/layout.ts`: `ownedBy`
- `packages/ink/src/ink.ts`: `inkPaint`
- `packages/sync-protocol/src/routes.ts`: `SyncRouteName`
- `runtime/opencode/plugin/decks-session.ts`: `DecksSession`
- `e2e/harness.mjs`: `rangeOf`, `rangeOfAttr`

Not dead, though the scan said so: `runtime/live-doc.ts`'s `mountLiveDoc` is the entry point of
the esbuild bundle `scripts/live-doc.mjs` writes to `packages/card-host/lib/live-doc.js`, which
`card.js` calls. Any export reached only through a committed bundle looks dead to a source scan;
`live-doc.ts` is the only one.

**Deduplicate**: `cssEscape` is defined twice, in `packages/canvas/src/camera/stage-ops.ts` and
`packages/agent-ui/src/chat/Stream.tsx`. Both packages depend on `@decks/ui`; put it there.

**Decide: production code that only a test calls.** 184 exports are referenced from nowhere but a
`*.test.*` file or a `.md`. Most are constants and helpers exported so a test can read them
(`MIN_ZOOM`, `QUEUE_LIMIT`, `glideAt`); that is a convention, not dead code, and the rule should be
written down once (§5) rather than fought. A few are whole features the app does not use, and those
are the ones to decide:

- `packages/ink/src/ink.ts`: `moveStroke`, `inkHistory`, `inkCommit`, `inkUndo`, `inkRedo`, an undo
  history the app does not use (its undo goes through the server's canvas edits)
- `apps/server`: `sameWorkspace` (agents/workspaces), `readCliToken` (auth/cli-token), `forgetFfmpeg`
  (files/media), `renameStage` (stage/stage-admin), `gitPull`, `gitPush`, `gitStatus` (docs/git)
- `packages/docs`: `applySplices` (merge), `storedZip` (server/fixtures)
- `packages/agent-ui`: `distinctNames` (chat/tool-groups), `edgeOwner` and `setInspectable` (edge.ts,
  read only by `apps/web/src/state/edge.test.ts`, a test of a shim)

`packages/canvas/src/edit/core/fake-scene.ts` is a test helper (nine tests import it, no production
file). Rename it `fake-scene.test-helper.ts`, the convention `apps/server/src/stage/run-code.test-helper.ts`
already set, so the two agree.

### 3.3 Over-exported: 323 symbols exported but used only in their own file

Not dead, but every `export` widens the surface a reader has to assume is depended on. By place:
`packages/canvas/src/edit/core` 41, `apps/server/src/migrations` 22, `canvas/src/render` 19,
`canvas/src/model` 16, `apps/server/src/stage` 16, `canvas/src/frame/inside` 14, `canvas/src/items`
13, `apps/server/src/auth` 11; the rest in ones and twos. The fix is mechanical (drop the keyword) and
typecheck proves it. Two exceptions:

- the package entry points (`index.ts`, `public/*.ts`), where an export is the API;
- **`packages/canvas/src/public/host.ts` does `export * from "../render/engine.ts"`**, so every
  export of the 2,443-line engine is `@decks/canvas/host`'s API, whether or not a host wants it. The
  Decks app reaches `StageEngine` and `pixelsFirst` through it. Replace the star with a named list of
  what the app and Studio use, in the same commit that splits the engine (§4.1), so the engine's new
  modules can keep their internals unexported.

Do the over-exports per package in one commit each, **after** the moves in §4, so a move's diff is
only a move.

### 3.4 CSS classes no markup uses

Twenty-three class names are declared in the app's and the packages' sheets and appear in no `.ts`,
`.tsx`, `.html` or `.mjs`, allowing for a `stem-${…}` built in code. By sheet:

| sheet | classes |
|---|---|
| `packages/canvas/styles/chrome.css` | `picker-google-hint act-hold act-land act-draw lucide-search` |
| `apps/web/src/styles/marks.css` | `act-hold act-land act-draw` |
| `apps/web/src/styles/stages.css` | `stage-count stage-current stage-keys` |
| `packages/canvas/styles/canvas.css` | `bar-track act-hold act-land` |
| `apps/web/src/styles/v3.css` | `v3-app-icon fps-tag` |
| `apps/web/src/styles/connections.css` | `pair-code pen-bar` |
| one each | `dock.css: lucide-chevron-down`, `forms.css: action-button`, `settings.css: account-row`, `shell.css: panel-mark-name`, `properties.css: lucide-search` |

The `lucide-*` names are written into the SVGs by the icon library and are real; keep them. The
`act-*` trio is declared in three sheets and used in none, which is how a rule outlives its markup
three times. Each sheet is its own commit with a baseline re-stamp, so the cascade diff shows which
rules left and that nothing moved. Checks: `chrome`, `panel`, `shell`, `stages`, `selection`.
(`menu-rule`, flagged by the scan, is written in `frame/ToolColumn.tsx`; it stays.)

### 3.5 Scripts and checks nothing runs

- `e2e/checks/cards-smoke.mjs` is not in `run.mjs`'s `CHECKS`; its header says it runs by hand
  against an external server. `scripts/opencode2-live.mts` (a real OpenCode 2 and a real model) and
  `scripts/card-zoom.mjs` (an iPad pinch profile) are referenced by nothing either. All three are
  tools, not dead code, but a reader cannot tell. Either list them in a `scripts/README.md` (two
  lines each: what it measures, how to run it) or move the check to `e2e/manual/`. The old
  `scripts/awake-bench.mjs` and `e2e/checks/awake-bench.mjs` share a name and a purpose (one measures,
  one checks); say so in that README.
- `e2e/README.md` still documents `mobile.mjs`, `board-kinds.mjs`, `accounts.mjs`, `renderers.mjs`,
  `usage.mjs`, `embed-*.mjs` as checks. `run.mjs` keeps them as deliberate history ("in git, not gone");
  the README should say the same in one line rather than table them as if they ran.

### 3.6 Dependencies nothing imports

- `apps/web/package.json` declares `@decks/stage`, `highlight.js` and `mathjax-full`; nothing under
  `apps/web` imports them (`@decks/canvas` declares and uses all three). Remove them and let
  `npm run build -w @decks/web` prove it.
- `packages/canvas/package.json` declares `vite-plugin-solid` and `@tailwindcss/vite` as devDependencies;
  nothing under the package imports them. `vite` stays (`tsconfig.json` types `vite/client`), as does
  `@types/node`. Check `scripts/build-solid-lib.mjs` before removing the two.
- `apps/server/package.json` declares `@decks/sync-protocol`; no file under the server imports it.
  `astcenc` and `esbuild` are reached by `require.resolve` and by scripts, and stay.

### 3.7 Comments that name files that no longer exist

A scan of backticked file names in comments and docs finds 116 names with no file of that basename
anywhere in the tree (data files such as `chat.json` excluded by hand). Most are modules of the
board era that were renamed or dissolved; a reader following the pointer finds nothing. The ones
cited from more than one place:

| named | cited from |
|---|---|
| `wire/boards.ts` (7) | `agents/session.ts`, `auth/app-trust.ts`, `stage/canvas-ops.ts`, `verbs/gestures.ts` |
| `items/live-cards.ts` (5) | `camera/controller.ts`, `items/item-slot.tsx`, `render/device.ts`, `styles/canvas.css` |
| `Inspector.tsx` (4) | `index.css`, `inspector.css`, `panel.css` |
| `frame-gestures.ts` (4), `board/frame-gestures.ts` | `index.css`, `camera/touch.ts`, `app/viewport.ts` |
| `canvas/BoardCallout.tsx` (4) | `e2e/checks/context.mjs`, `e2e/harness.mjs`, `styles/canvas.css` |
| `board-news.ts` (3) | `deck/loader.ts`, `frame/inside/boot.ts`, `protocol/src/deck.ts` |
| `share/pairing.ts` (6, three spellings) | `stage/service.ts`, `verbs/misc.ts`, `connections/backend.ts`, `vite.config.ts`, `protocol/src/wire.ts`, `auth/hosts.ts` |
| `pen/layer.ts`, `canvas/pen/layer.ts`, `layer.ts` (8) | `edit/dom/pointer.ts`, `stage/Stage.tsx`, `stage/input.ts`, `render/engine.ts`, `edit/dom/TextEditing.tsx`, `styles/canvas.css` |
| `markdown-layout.ts` (5) | `model/markdown.ts`, `styles/canvas.css`, `crates/text/src/card.rs` |
| `paint.ts` (3) | `items/MediaPlayer.tsx`, `render/media-look.ts`, `stage/items-layer.tsx` |
| `boards/thumbs.ts`, `boards/templates.ts`, `board/glow.ts`, `Markdown.tsx`, `lib/panels.ts`, `wire/pen.ts` | one or two each |
| `Editor.ts`, `PageFrame.tsx`, `InkLayer.tsx`, `comment-select.ts` | all four in `apps/web/src/canvas/CanvasOps.tsx` |

The fix is a sweep, one commit per workspace, each pointer rewritten to the module that does the
work now or dropped. The scan (§7) is the tool; run it after each move in §4 as well, since every
move makes more of these.

### 3.8 Numbers that drifted

`CONTRIBUTING.md` and `test.yml` say the app has 13 stylesheets; `index.css` says 18; `css:order`
flattens 21. Write "the app's stylesheets" and let the gate's output carry the number.

### 3.9 One failing test

`packages/pen/src/schema.test.ts` fails: `runtime/skills/canvas-design/schema.md` is out of date
with the package. `node --import tsx scripts/gen-pen-schema.mjs` regenerates it. A generated file
that drifts is the reason the test exists; regenerate it in Phase 0.

### 3.10 Compatibility layers with a release date

Four layers were written "for one release" when the vocabulary changed, and nothing yet records
which release that is:

| layer | lines | what it keeps alive |
|---|---|---|
| `apps/server/src/wire/legacy.ts` | 221 | the tab socket's 52 old `ClientMessage` requests, each as an alias of a person's verb |
| `apps/server/src/routes/agents.ts`, `harness.ts`, parts of `deck.ts`, `google.ts`, `apps.ts` | ~250 | `/api/agents/:id/…`, `/api/harness`, `GET /deck`, `/google/*`, `/apps/:name/seen` as aliases of verbs (Decks Studio reads `/api/agents/:id/…` and `/api/harness`) |
| `packages/protocol/src/names.ts` `OLD_EVENT_NAMES`, `apps/server/src/ws.ts` | ~60 | the 21 old event names, said to a socket whose hello lacks `v: 2` (the iOS app) |
| `apps/server/src/verbs/renamed.ts` | 46 | the wording of a refusal for the verbs removed with boards; runs nothing |
| the per-agent `stage.pen` copies on the tab socket | | the drawing a release-ago page expects |

None of this is dead today: the iOS app and Decks Studio send the old shapes. But a layer with no
date is a layer that stays. Proposal: a `docs/COMPAT.md` with one line per layer naming the client it
serves, the check that proves the alias still works (`router.test`, `line.test`), and the condition
for removal ("the iOS app says `v: 2`", "Studio calls `POST /api/v1/agent.list`"). `wire/` is a
directory of one file; when `legacy.ts` goes, so does the directory, and `settleStage` with it moves
back beside its callers. Removing the layers is Phase 6 and depends on the clients, so it is listed
last and may not happen in this pass; writing the file down is Phase 0.

## 4. Structure

### 4.1 `packages/canvas` (191 files, 39.1k lines)

The package is grouped now, and the groups are right. What is left:

- **`render/engine.ts` is 2,443 lines, one class.** Its own section markers say what it holds:
  lifecycle, worker bridge, camera, layout and tiles (186–1446), cards (1446–1739), pictures, fonts
  and icons (1739–2005), gestures (2005–2306), questions (2306–2425). It writes 17 `globalThis`
  casts. Everything a host sees of it is `export *`'d from `public/host.ts` (§3.3).
- **`render/` holds two things.** The GPU engine and its worker (`engine.ts`, `render.worker.ts`,
  `backends/`, `device.ts`, `measure.ts`, `reader.ts`, `recovery.ts`, `spatial.ts`, `picture-ladder.ts`,
  `types.ts`), and how words, icons and media look (`font-files.ts`, `font-coverage.ts`,
  `highlight.ts`, `math.ts`, `look.ts`, `media-look.ts`, `icons.ts`, `icon-index.ts`). The second
  group is imported by `edit/`, `items/`, `ui/` and the Decks app, not by the engine alone.
- **`edit/` holds two editors.** `edit/core/` and `edit/dom/` are the drawing's editor, with
  `edit/index.ts` as its door. `edit/CardEditor.tsx` (1,469 lines) is the markdown card's text
  editor and shares nothing with them; `edit/StageInk.tsx`, `edit/ink.ts` and `edit/ink-keys.ts`
  are ink. `edit/index.ts`'s own header says the editor is still absorbing "what the stage still
  does with the editor's pieces itself".
- **`ui/Properties.tsx` is 1,248 lines**: one component for every property of every kind
  (fill, line, text, arrange, effects), with `Effects`, `NumField`, `ColorField`, `Swatches` and
  `IconToggle` at the foot.
- **33 `__decks*` globals** are written from 11 files with 48 `(globalThis as {…})` casts. Nine are
  measuring knobs the engine and camera read (`__decksHalfZoom`, `__decksTileBudget`,
  `__decksPictureMB`, …); the rest are probes the browser checks call (`__decksRust` 146 times across
  the checks, `__decksCards` 88, `__decksPenBox` 60, `__decksCameraTransform` 45, `__decksSheet` 36,
  `__decksEngine` 28). There is no one place to see them, and no type for any of them.
- The comments still speak the old vocabulary: `Stage.tsx` says "one transform over the boards",
  `items-layer.tsx` "cards, documents, apps and boards", `edit/index.ts` points at
  `canvas/Stage.tsx`, which is `stage/Stage.tsx`. The code is right; the prose lags (§3.7).
- `lib/` holds one 13-line file, `theme.ts`.

Proposed layout. Entry points (`index.ts`, `public/*`) and the package's `exports` do not change, so
neither does what Decks Studio imports.

```
src/
  index.ts  public/  editor.tsx  types.ts  host.ts  theme.ts   the API (theme.ts ← lib/theme.ts)
  debug.ts                           NEW: every knob and probe, typed, in one object (§4.4)
  camera/  model/  items/  frame/    unchanged
  render/                            the engine alone
    engine.ts                        the class: lifecycle, worker bridge, setDoc/setCards/setCamera, layout
    tiles.ts                         TileQueue: budget, takeTiles, warm, showAnyway, drop
    pictures.ts                      PictureStore: want/fit/fetch/stand-ins/retry/compressed, the byte budget
    fonts.ts                         FontLoader: need/prefetch/fetch/give/post
    hits.ts                          the questions: onPath, linkAt, cardAt, scrollBy
    gestures.ts                      preview, carry, ink over everything
    render.worker.ts  backends/  device.ts  measure.ts  reader.ts  recovery.ts  spatial.ts  picture-ladder.ts  types.ts
  look/                              ← render/: how words, icons and media look, for every surface
    font-files.ts  font-coverage.ts  highlight.ts  math.ts  look.ts  media-look.ts  icons.ts  icon-index.ts
  edit/                              the drawing's editor only: core/  dom/  index.ts  held.ts  snap.ts  scene-ts.ts  pen-tools.ts
  cards/CardEditor.tsx               ← edit/; split as below
  ink/                               ← edit/StageInk.tsx  edit/ink.ts  edit/ink-keys.ts
  stage/  ui/                        unchanged; Properties.tsx split as below
```

How to split `engine.ts` without changing behaviour: extract **collaborators the engine owns**, not
mixins. `PictureStore` takes the `post` function and the budget facts; `TileQueue` takes `post` and
the clock; `FontLoader` takes `post` and the font list. The engine keeps its public method names
(the checks and the app call them) and delegates. Each extraction is one commit, proven by the
checks that exercise that region: pictures by `one-picture`, `zoom-out-pictures`, `placeholder`,
`card-fit`; tiles by `tile-pixels`, `stage-goldens`, `render-perf` (measure only); fonts by
`text-shots`; hits by `selection`, `item-pill`, `board-links`; gestures by `awake-drag`,
`pencil-then-finger`, `smooth-edits`. `pictures.ts` and `tiles.ts` then get the unit tests their
arithmetic has lacked, because they no longer need a worker to construct.

How to split `CardEditor.tsx`: the markdown-to-DOM rendering (lines ~100–340, `marked` tokens to
pieces), the DOM-to-markdown reading (~430–560), and the floating bar's placement (~705–760) are
pure functions over a document and a selection; move them to `cards/card-dom.ts` and
`cards/card-bar.ts` with unit tests, and leave the component the wiring. Checks: `card-editor`,
`card-phone`, `cards-smoke` by hand.

How to split `Properties.tsx`: one file per section (`properties/Fill.tsx`, `Line.tsx`, `Text.tsx`,
`Arrange.tsx`, `Effects.tsx`) and `properties/fields.tsx` for `NumField`, `ColorField`, `Swatches`,
`IconToggle`; `Properties.tsx` keeps the selection reading (`shared`, `kindOf`) and the order.
Checks: `shapes`, `bent-arrows`, `selection`.

### 4.2 `apps/web` (194 files, 31.1k lines)

What is wrong:

- **The design iteration's name is still the code's name.** `styles/v3.css` is 3,624 lines, the
  largest source file in the repository: 238 classes, 101 of them `v3-*`, 28 `--v3-*` tokens. There
  is no v1 or v2 left.
- **`v3.css` is an override layer, not a sheet.** Its header says it is "last in `index.css` … so a
  rule here wins a tie with the sheets it restyles". 97 of its 238 classes are also styled in
  another sheet, many in several: 25 in `panel.css`, 24 in the canvas's `chrome.css`, 18 in
  `shell.css`, 15 in `dock.css`, 12 in `connections.css`, 10 in `stages.css`, 9 in `composer.css`,
  9 in agent-ui's `stream.css`, 8 each in the canvas's `ink.css` and `properties.css`. Its section comments are a
  changelog ("step 3: the side panel", "step 4: the composer", "step 6: iPad and iPhone", "step 7",
  "as Studio draws it"). A reader of `panel.css` cannot know what the panel looks like without a
  second file, which is the problem `css:order` exists to catch.
- **The directories left after the shims go** (§3.1): `chat/` is the composer plus `Dialog.tsx`,
  `alerts/` one file, `ui/` one file, `camera/` one 23-line file.
- **Two chromes, named apart.** `chrome/` is the page's shell around the canvas (TopBar, TopRight,
  ChatSection, NoticeStrip, ContextRing, PictureProgress, tooltip); `frame/` is the chrome the app
  draws *inside* the canvas frame (ToolColumn, PenTray, ZoomBar, `chrome.tsx`). Both are right, but
  `frame/chrome.tsx` and `chrome/` side by side make a reader check which is which.
- **The old vocabulary is in the names.** `canvas/StageManager.tsx` is the canvas manager
  (`docs/DESIGN.md` calls it that); `state/stages.ts` lists canvases; `styles/stages.css` styles
  the manager. Their headers still say "every stage in the deck".
- **Three pages at the root.** `measure.ts`, `shot.ts`, `canvas-frame.tsx` and `index.tsx` are the
  four Vite entries; `measure/page.ts` is the first one's helper, in a directory of its own.
- `panel/LeftPanel.tsx` (1,094 lines) draws four tabs (`agents`, `recent`, `canvas`, `apps`, each a
  `<Show>` from line 845 on) and the panel's drag-resize in one component. `agents/AgentPill.tsx`
  (810) holds five components: `AgentFace`, `AgentChoices`, `NewAgentButton`, `AgentMenu`, `AgentPill`.

Proposed layout:

```
src/
  pages/                index.tsx  canvas-frame.tsx  shot.ts  measure.ts  measure-page.ts   (the html files at the app root point here)
  App.tsx               stays: 934 lines of wiring and JSX, under the line
  app/                  unchanged: the controllers
  shell/                ← chrome/ + ui/ConfirmDialog.tsx: the page's chrome around the canvas
  frame/                unchanged: the app's chrome inside the canvas frame (a README line says so)
  composer/             ← chat/composer/
  agents/Dialog.tsx     ← chat/Dialog.tsx (a runtime asking the person; it belongs with agents, not with the composer)
  settings/AlertSettings.tsx   ← alerts/
  state/views.ts        ← camera/agent-views.ts
  canvases/             ← canvas/: CanvasManager.tsx (← StageManager.tsx), CanvasSwitcher, CanvasOps, pass.ts
  state/canvases.ts     ← state/stages.ts
  panel/                LeftPanel.tsx (the shell, the search, the tabs' order) + tabs/AgentsTab.tsx RecentTab.tsx CanvasTab.tsx AppsTab.tsx + panel-resize.ts
  agents/               AgentPill.tsx split into AgentFace.tsx, AgentMenu.tsx, NewAgentButton.tsx
  styles/
    theme.css           ← v3.css lines 1–93: the `body` tokens, light and dark, renamed --ui-*
    motion.css          ← v3.css 1685–2101: the motion system
    canvases.css        ← stages.css (same position in index.css, so the hash does not move)
    <feature>.css       each override from v3.css folded into the sheet that owns the class
```

Folding `v3.css` is the one part of this plan the cascade gate will fight, and that is the point:
do it **one target sheet at a time** (start with `panel.css`, 25 classes), move each overriding rule
to sit after the rule it overrides in the owning sheet, run `npm run css:order`, read which ties it
reports, re-stamp. Where a rule overrides a package sheet (`chrome.css` 24, `stream.css` 9,
`ink.css` 8, `properties.css` 8, `canvas.css` 4, `host.css` 2: 55 rules), the override goes into
the app's sheet for that surface, **never into `packages/*/styles/`** (§4.6). Rename the `--v3-*`
tokens and `v3-*` classes last, as pure renames, since a rename changes every rule's hash and would
hide a real move if combined with one.

### 4.3 `apps/server` (343 files, 55.3k lines)

Organised by domain and mostly out of this plan's scope: `agents/`, `deck/`, `verbs/`, `auth/`,
`runtimes/<name>/`, `pictures/`, dated `migrations/` documented as run-on-read, `studio/` one
well-described module. Three things belong in this pass, and one does not yet.

- **The vocabulary.** The data was migrated (`2026-10-16-stages-to-canvases`,
  `2026-10-29-boards-to-cards`), the wire renamed (`names.ts`), the verbs renamed (`renamed.ts` lists
  the old ones). The code's own names were not: `stage/` is the canvas service (`service.ts`: "the
  single path from a tool to the canvas"), `StagePens` is the canvas's drawing, `App.boards` is the
  cards, `deck/stage-boards.ts` is a canvas's own cards, `verbs/board.ts` returns the `card`, `frame`
  and `file` verbs, `stage-admin.ts` renames canvases. A reader who knows the product's words has to
  learn a second set to read the server. A rename pass is pure (typecheck proves it) but wide; do it
  as its own series after the compat layers go (§3.10), because `legacy.ts` and the alias routes are
  the files that mention the old names most and will be deleted, not renamed.
- **Dead and over-exported** (§3.2, §3.3): the two dead exports, `deck/layout.ts` shim, and the 94
  over-exports, 22 of them in migrations that are not read again.
- **The `wire/` directory** holds one file, `legacy.ts`, which is on the §3.10 list.
- **Not in this pass**: `agents/session.ts` (2,153 lines, one class `DeckAgent`), `runtimes/claude/backend.ts`
  (1,712), `stage/pens.ts` (1,334), `app.ts` (1,162). Each wants its own design with the behaviour
  it owns laid out first; splitting them by eye would be a reformat with risk and no test to show for it.

### 4.4 Measuring knobs and test probes: one registry

Today a knob is `(globalThis as { __decksHalfZoom?: boolean }).__decksHalfZoom` written where it is
read, and a probe is a function assigned to `globalThis` from inside a component body. Proposal,
`packages/canvas/src/debug.ts`:

```ts
/** What the browser checks and the profiling scripts reach from outside; nothing else reads this. */
export const knobs = { halfZoom: true, pinchTail: false, exactCamera: false, tileBudget: …, pictureMB: …, picturesPerFrame: 1, skipLevels: …, tilePixels: false, warm: …, noGlide: false, pictureFades: true };
export const probes: { engine?: StageEngine; rust?: unknown; cards?(): …; cardAt?(…): …; penBox?(id: string): DOMRect | undefined; cameraTransform?(): string; frameUnder?(…); pictureAt?(…); sheet: SheetStats; touchLog?: …; made?: …; frame?: { state?; news?; drawn?; camera?; select? } } = { sheet: { shown: 0, tiles: 0 } };
Object.assign(globalThis, { __decksKnobs: knobs, __decksProbes: probes });
```

33 names become 2, each typed once. Because the checks read `__decksRust` 146 times and
`__decksCards` 88, do the move in two commits: first `debug.ts` assigns the old names too (aliases),
with every writer repointed; then the checks and `scripts/ipad-profile.mjs`, `card-zoom.mjs`,
`render-perf.mjs` move to the new names and the aliases go. Checks: everything that reads a probe:
`camera`, `stage-gestures`, `one-picture`, `drop-lands`, `card-editor`, `pen-stage`, `tile-pixels`,
`glide`, `awake`, `canvas-frame`. `apps/web/src/perf/probe.ts` keeps its `?probe=` gate and reads
from the same object.

### 4.5 Shared packages, `e2e`, `scripts`, `runtime`

- **Tests live in two places.** Eleven workspaces co-locate `*.test.ts` beside the source; `hub`,
  `sdk`, `sync-client`, `sync-protocol` and `card-host` keep a `test/` directory. Co-locate the five
  (a `git mv` each, and the package's `test` glob widened where it names `test/`).
- `packages/docs` has three files over 1,700 lines (`page/gview.ts` 2,090, `page/live.ts` 2,052,
  `page/page.ts` 1,750) and `packages/sync-client/src/sync.ts` is 1,299. Same verdict as the server's
  big files: their own design, not this one.
- `packages/stage`: `pkg/` and `pkg-gl/` (11.5 MB of built wasm) are committed on purpose so the app
  builds without Rust; keep that. The crates were not checked for dead code here (no `cargo`); run
  `cargo build --release --target wasm32-unknown-unknown -p stage-web 2>&1 | grep warning` on a
  machine with the toolchain. The crates declare no `#[allow(dead_code)]`, so warnings are the truth.
- `e2e/harness.mjs` is 1,166 lines and 45 exports; it is one file by design (the checks import one
  thing) and stays.
- `runtime/`, `extension/`, `examples/` are small and clean.

### 4.6 Decks Studio, the other host

Decks Studio vendors this repository and can import only what the packages' `exports` maps name:
`@decks/canvas`, `/comments`, `/tools`, `/camera`, `/host`, `/card`, `/card-reading`,
`@decks/agent-ui/chat`, `/composer`, `/alerts`, `/edge`, `/vite`, `@decks/ui`, `/float`,
`/agent-marks`, and the protocol, pen, hub, sdk and sync packages. No deep import into any `src/`
reaches it. Its one stylesheet import is `@decks/canvas/canvas.css`, the `dist/canvas.css` that
`packages/canvas/scripts/build-css.mjs` compiles from `styles/standalone.css`. `v3.css` is the app's
and has never reached Studio. (The Studio repository was not reachable from the session that wrote
this; these facts are from the earlier design's check of it and from this tree's `exports` maps.
Confirm them against Studio's imports before Phase 4.)

Two constraints follow, and both are already in §4.1 and §4.2:

1. **Fold `v3.css` into the app's sheets, never into the packages'.** The 55 rules that override
   package classes go into `apps/web/src/styles/`; moved into `packages/canvas/styles/` they would
   ship to Studio in its next `dist/canvas.css` and change its look.
2. **The package `exports` maps do not change.** `render/` splitting into `render/` and `look/`,
   `edit/` losing `CardEditor.tsx` and ink, `public/host.ts` narrowing its star export: all are
   behind the entry points. The one thing Studio could notice is a symbol that `export *` from
   `engine.ts` exposed and the named list drops; list what Studio imports from `@decks/canvas/host`
   before writing that list.

## 5. Guardrails, so it stays clean

1. **A dead-export gate in CI.** The scan behind §3.2 is sixty lines; write it as
   `scripts/dead-exports.mjs` beside `css-order.mjs`, same shape (exit 1 naming each symbol), with an
   allowlist for the `public/` entry points and for the tests-only convention (an export whose only
   readers are tests is allowed when the test file sits beside it). Add it to `test.yml`. `knip` is the
   off-the-shelf alternative and understands workspaces; it could not be run in this sandbox.
2. **A dead-CSS gate**, the same way: `scripts/dead-css.mjs`, allowlisting `lucide-*` and anything a
   card's own HTML writes.
3. **A stale-pointer gate**: `scripts/stale-paths.mjs`, the §3.7 scan, warning (not failing) on a
   backticked file name with no file of that name. It will keep the prose honest after every move.
4. **`docs/COMPAT.md`** (§3.10), and a line in `CONTRIBUTING.md`: a layer kept "for one release"
   names the release, the client and the check.
5. **`CONTRIBUTING.md`**: move the importers with the module (§3.1); name a directory for what it
   holds, not when it was made (no `v3/`); knobs and probes go through `debug.ts` (§4.4); a test
   helper beside production code is `*.test-helper.ts` (§3.2); tests sit beside their source (§4.5).

## 6. Sequence

Each line is a commit or a short run of them. Each leaves `npm run typecheck`, `npm test` and
`npm run css:order` green; the browser checks named are the ones to run for that step.

**Phase 0: hygiene** (an hour)
1. Regenerate `runtime/skills/canvas-design/schema.md`; `npm test -w packages/pen` is green. (§3.9)
2. Drop the unused dependencies from `apps/web`, `packages/canvas`, `apps/server`; `npm run build`. (§3.6)
3. `scripts/README.md` for the three by-hand tools; `e2e/README.md`'s table of checks that no longer run becomes one line. (§3.5)
4. The sheet counts (§3.8). `docs/COMPAT.md` written, nothing removed yet. (§3.10)

**Phase 1: dead code** (a day)
5. Delete the 11 zero-importer shims. (§3.1)
6. Repoint and delete the remaining 14, `deck/layout.ts` and `ui/icons.tsx` each as its own commit. (§3.1)
7. Delete the 18 dead exports, one commit per workspace; `cssEscape` into `@decks/ui`; `fake-scene.test-helper.ts`. (§3.2)
8. Decide the whole-feature tests-only exports (ink history, git helpers, `edge.ts`); delete or keep each with a line saying why. (§3.2)
9. Unused CSS, one sheet per commit, baseline re-stamped each time. Checks: `chrome`, `panel`, `shell`, `stages`, `selection`. (§3.4)
10. The stale-pointer sweep, one commit per workspace. (§3.7)

**Phase 2: the registry** (half a day)
11. `debug.ts` with aliases; writers repointed. Then the checks and scripts move; aliases go. Checks as in §4.4.

**Phase 3: `packages/canvas` layout** (two to three days)
12. `lib/theme.ts` → `theme.ts`; `render/` → `render/` + `look/`; `edit/CardEditor.tsx` → `cards/`; ink → `ink/`. Pure moves; typecheck proves them; the stale-pointer scan after each.
13. `public/host.ts`: the named list in place of `export * from engine.ts`. Confirm against Studio's imports first. (§3.3, §4.6)
14. Extract `render/pictures.ts`. Checks: `one-picture`, `zoom-out-pictures`, `placeholder`, `card-fit`.
15. Extract `render/tiles.ts`. Checks: `tile-pixels`, `stage-goldens`, `render-perf` (measure only).
16. Extract `render/fonts.ts`, `render/hits.ts`, `render/gestures.ts`, one each. Checks: `text-shots`, `selection`, `item-pill`, `board-links`, `awake-drag`, `pencil-then-finger`, `smooth-edits`.
17. Split `cards/CardEditor.tsx` (card-dom, card-bar, with tests). Checks: `card-editor`, `card-phone`.
18. Split `ui/Properties.tsx` into `ui/properties/`. Checks: `shapes`, `bent-arrows`, `selection`.
19. Drop the over-exports in the package. (§3.3)

**Phase 4: `apps/web` layout** (two days)
20. `pages/`; `chrome/` + `ui/` → `shell/`; `chat/composer/` → `composer/`; `chat/Dialog.tsx` → `agents/`; `alerts/`, `camera/` dissolved. Pure moves.
21. `canvas/` → `canvases/`, `StageManager` → `CanvasManager`, `state/stages.ts` → `state/canvases.ts`, `stages.css` → `canvases.css` in the same slot of `index.css`. A rename commit; `css:order` says the hash did not move. Checks: `stages`, `shell`.
22. `LeftPanel.tsx` into tabs and `panel-resize.ts`; `AgentPill.tsx` into its five components. Checks: `panel`, `panel-steady`, `agents-tab`, `agent-rows` (needs a model), `per-agent`.
23. Fold `v3.css` into its targets, one target sheet per commit, starting with `panel.css`; `theme.css` and `motion.css` are what remains. Overrides of package classes land in app sheets (§4.6). Checks: `chrome`, `panel`, `panel-steady`, `shell`, `stages`, `card-phone`, `canvas-frame`.
24. Rename `--v3-*` to `--ui-*` and `v3-*` to `shell-*`, as a pure rename.
25. Drop the over-exports in the app and the server. (§3.3)

**Phase 5: guardrails** (half a day)
26. `scripts/dead-exports.mjs`, `dead-css.mjs`, `stale-paths.mjs`, in `test.yml`. (§5)
27. `CONTRIBUTING.md`. (§5)

**Phase 6: the release that removes the compat layers** (when the clients allow)
28. `wire/legacy.ts` and its directory; the alias routes; `OLD_EVENT_NAMES`; `renamed.ts`'s wording stays as long as agents may say an old verb. Each with its line struck from `COMPAT.md`. Checks: `router.test`, `line.test`, `canvas-frame`, `apps-in-frame`.
29. Then, and only then, the server's vocabulary rename: `stage/` → `canvas/`, `StagePens` → `CanvasPens`, `App.boards` → `App.cards`, `stage-boards.ts` → `canvas-cards.ts`, `verbs/board.ts` → `verbs/card.ts`, `stage-admin.ts` → `canvas-admin.ts`. Pure renames, one per commit, after the files that mention the old names most have been deleted rather than renamed. (§4.3)

Phases 1 and 2 can go in any order and in parallel. Phase 3 before Phase 4 only because the canvas
moves change import paths the app uses; doing the app first would touch the same imports twice.
Phase 6 waits on the iOS app and Studio, and this document does not assume it happens in this pass.

## 7. How the inventory was made

Four scans over `git ls-files`, excluding `node_modules`, `dist`, `pkg`, `pkg-gl`, `target`, the
vendored `packages/card-host/lib/` and `.bundle.` files:

- **Dead exports**: for every `export (function|const|let|class|interface|type|enum) Name`, count
  whole-word references to `Name` in every other tracked text file and in its own. Zero elsewhere and
  one at home is dead; zero elsewhere and more at home is over-exported; references only from
  `*.test.*`, `test-helper` or `.md` is tests-only. Each dead hit was then confirmed with `git grep -w`.
- **Shims**: a source file of at most two non-blank lines that `export … from`; importers counted by
  resolving every relative `from "./…"` in the tree to a path and comparing.
- **Dead CSS**: every `.class` token in the app's and packages' sheets (comments stripped) against
  every `.ts`, `.tsx`, `.html` and `.mjs`, accepting a class whose `stem-` prefix is built in code.
  `cascade-order.json` is excluded, since it names every class by construction.
- **Stale pointers**: every backticked `name.ext` in comments and docs whose basename is no file in
  the tree; data-file names (`deck.json`, `chat.json`, …) dropped by hand.

Orphan files were found by stem (a basename no other file mentions). Unused dependencies by grepping
each declared package name under its workspace. The big files were outlined by their top-level
declarations and section markers; `v3.css` by its own section comments and by the overlap of its class
names with every other sheet. The scans are heuristics; §3 says where each can be fooled. The
baseline in §1 was measured in this session with `npm ci`, `npm run typecheck`, `npm run css:order`
and each workspace's `npm test`.
