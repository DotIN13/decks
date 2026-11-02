# Reorganizing studio-canvas

A design for cleaning up the code on the `studio-canvas` branch: what is dead, what is in the
wrong place, what is too big, and the order to fix it in so every commit stays green. Written
2026-11-02 against commit `235a06b`.

The numbers here come from scans of the tree (see §7). Every "dead" claim was checked by name
against every tracked `.ts`, `.tsx`, `.mjs`, `.html`, `.json` and `.md` file outside `_scratch/`.
Where a scan can be fooled, the entry says so and what to check before deleting.

## 0. Status: built on `studio-canvas-reorg`

Done on 2026-11-02, as the 19 commits after this document on the branch `studio-canvas-reorg`,
one step each, every one green on `npm run typecheck`, `npm test`, `npm run css:order` and the two
new gates. Where the work differed from the plan below, this is why:

- **`App.tsx` was not split (§4.2, step 19).** The 754-line menu closure the plan describes was a
  mis-measurement: the closure is 21 lines; the 2,100 lines are mostly the component's JSX. The two
  float helpers capture 18 of the component's names, so extracting them would mean a host object
  the size of the code. Left as it is.
- **The engine's picture store and tile queue stayed in the engine (§4.1, steps 13 and 14).** They
  share the engine's `page`, `camera`, `draw()` and `picturesAsked` with everything else; what came
  out cleanly is `tiles.ts` (the helpers), `compressed.ts`, `fonts.ts` (`FontLoader`) and
  `hits.ts`. Likewise the Stage: `fingers.ts`, `media.ts` and `probes.ts` came out; the camera
  wiring and the live set did not, since both are effects over the component's signals.
- **`v3.css` was split, not folded (§4.2, step 20).** Its 253 overrides of other sheets' classes
  each decide a cascade tie, and folding them is design work rule by rule. It is four sheets now,
  named for what they hold and imported in the same order, so the cascade is byte for byte the
  same (the gate's hash did not change), and nothing moved into the canvas package, which is what
  Studio needs (§4.6). The `v3` prefix is gone from tokens (`--ui-*`), classes (`shell-*`) and prose.
- **The browser checks ran on WebGL 2 here.** This container's Chromium crashes with WebGPU on, so
  the harness gained `DECKS_E2E_GPU_ARGS` and the suite ran with SwiftShader: 32 of 58 checks pass
  on the branch's base in that setting, and the same 32 after each step, with two timing-bound
  exceptions worth a look on a real machine: `shapes.mjs` and `glide.mjs` land their opening zoom
  on a knife-edge of the harness's 350 ms wait and flipped either way between runs here (the
  camera, the live flag and the engine were measured identical before and after). The checks that
  need a model were not run.
- **One check went rather than being revived:** `e2e/checks/apps.mjs` was never in the runner's list
  and was out of date twice over; it is in git if an apps check is wanted again.

## 1. Where the branch stands

| | |
|---|---|
| commits on the branch | 50 (no merge base with `main`: the clone is shallow) |
| source lines (ts, tsx, mjs, rs, css, wgsl) | ~202,000 across 20 workspaces |
| largest workspaces | `apps/server` 50.7k, `packages/canvas` 33.9k, `apps/web` 32.0k, `packages/stage` 23.8k, `e2e` 17.2k |
| `npm run typecheck` | passes |
| CI (`.github/workflows/test.yml`) | typecheck, `css:order`, unit tests, package tests, browser checks |
| files over 1,000 lines | 28 (26 of them source, two vendored) |

The branch is healthy in the ways that matter most: it types, CI is wired, every script in
`scripts/` is referenced, and the Rust side is already split into seven crates by concern. What has
accumulated is the residue of fast iteration: a scratch directory committed by accident, compatibility
shims left behind after modules moved into packages, a design iteration's name (`v3`) baked into
file and class names, two 2,000-line files that grew by accretion, and a few hundred exports nothing
reads.

## 2. The rules this plan follows

From `CONTRIBUTING.md`, and they shape the sequencing below:

- **One idea per commit.** A move, a rename and a behaviour change are three commits. Every step in
  §6 is one commit or a short series of them, each passing `npm run typecheck`, `npm test` and
  `npm run css:order`.
- **The cascade is a test.** The 13 app stylesheets all declare in `@layer components`, so position
  decides ties. Any CSS move re-stamps `apps/web/src/styles/cascade-order.json` with
  `npm run css:order -- --update`, and the diff is read, not skipped.
- **No behaviour change rides along.** Everything in this document is a rearrangement. Where a step
  could change behaviour (removing a CSS rule, deleting a flag the browser checks read), it names the
  check that would catch it.

## 3. Dead code, verified

### 3.1 `_scratch/`: 328 tracked files that should never have been committed

`_scratch/` was added in commit `f434880` (2026-10-24), inside an unrelated feature commit. It
holds two complete copies of the e2e fixture deck (`decks-e2e-clean`, `decks-e2e-flicker`,
9.5 MB each, including a second and third copy of `mermaid.bundle.mjs` and `board.css`), a
folder of one-off flicker probes with two `.patch` files, and `panperf/` measurements.

Three things in it are worse than clutter:

- `_scratch/*/web-bridge.json` holds a 12-character pairing code. The repo's own `.gitignore`
  calls this file "a secret: a committed one is a live one until somebody notices".
- `_scratch/*/claude-accounts/index.json` names a real account's email and organisation.
- `_scratch/decks-e2e-flicker/claude-accounts/default/.credentials.json` and its siblings are
  **symlinks** (mode 120000) into `/home/decks/data/claude-accounts/agents/<uuid>/`. No token
  content is in git, but the paths leak a machine layout and an agent id.

Action, in one commit: `git rm -r _scratch`, add `/_scratch/` to `.gitignore` next to the other
"not source" entries, and delete the `web-bridge.json` on the machine that produced it so the
server mints a new pairing code. Because the branch is unmerged, the owner may also choose to
rewrite its history to drop the blobs (34 MB pack today); that is their call, since others may
have the branch checked out.

### 3.2 Twenty-seven one-line re-export shims in `apps/web`

When the conversation UI, alerts, icons and helpers moved into `@decks/agent-ui`, `@decks/ui` and
`@decks/canvas`, each old path was left as a one-line `export * from "…"` with the comment "this
keeps the old path". The old path is only worth keeping while something imports it.

| shim | importers | action |
|---|---|---|
| `chat/Markdown.tsx`, `chat/StatusLine.tsx`, `chat/TimeMachine.tsx`, `chat/ToolChip.tsx`, `chat/ToolGroup.tsx`, `chat/Turn.tsx`, `chat/composer/mention.ts`, `chat/float-rows.ts`, `chat/markdown.ts`, `chat/swipe-close.ts`, `chat/tool-groups.ts`, `chat/turn-cards.ts` | 0 | delete |
| `agents/agent-marks.tsx`, `alerts/notify.ts`, `alerts/sound.ts`, `chat/Stream.tsx`, `chat/composer/DraftField.tsx`, `chat/working-sign.ts` | 1 | repoint the importer, delete |
| `board/extent.ts`, `chat/history-page.ts` | 2 | repoint, delete |
| `alerts/policy.ts`, `chat/composer/draft.ts`, `chat/tool-results.ts` | 3 | repoint, delete |
| `lib/time.ts`, `state/edge.ts` | 5 | repoint, delete |
| `ui/Popover.tsx` | 14 | repoint, delete |
| `ui/icons.tsx` | 32 | repoint, delete (a `sed` over imports) |

After this, `apps/web/src/chat/` holds only the composer and `Dialog.tsx`, and `alerts/` only
`AlertSettings.tsx`. §4.2 renames both.

A rule for `CONTRIBUTING.md` so this does not recur: **when a module moves, move its importers in
the same commit.** A shim is a second name for one thing, and the cascade gate's lesson applies to
code too: two names for one rule is how the wrong one wins.

### 3.3 Exports nothing uses

Exported symbols that no file references, not even their own (so they are not merely over-exported).
Grouped by what to do.

**Delete outright** (no reference anywhere):

- `apps/web/src/board/shared-board.ts`: the whole file. Nothing imports it; its two functions
  (`sharedBoardSrc`, `attachSharedStorage`) are unused.
- `apps/web/src/board/board-links.ts`: `attachBoardOpen`, `BoardOpen`
- `apps/web/src/board/board-token.ts`: `attachBoardToken`
- `apps/web/src/connections/bundle.ts`: `isBundle`
- `apps/web/src/lib/session.ts`: `sessionToken`
- `apps/web/src/state/agent.ts`: `AgentScratchStore`
- `packages/canvas/src/camera/controller.ts`: `CameraController` (type)
- `packages/canvas/src/camera/coords.ts`: `deltaToBoard`
- `packages/canvas/src/editor/index.ts`: `StageEditor` (type)
- `packages/canvas/src/extent.ts`: `readingOf`
- `packages/canvas/src/lib/spring.ts`: `springEasing`
- `packages/canvas/src/pen/card-frame.ts`: `CARD_WIDTH`
- `packages/canvas/src/pen/font-files.ts`: `registeredName`
- `packages/canvas/src/pen/icons.ts`: `PenIcons` (a class)
- `packages/canvas/src/pen/math.ts`: `handFormulas`
- `packages/canvas/src/pen/media-look.ts`: `playTriangle`
- `packages/canvas/src/picture.ts`: `PaintEvent`
- `packages/canvas/src/stage/types.ts`: `PenHit`
- `packages/canvas/src/thumb-budget.ts`: `claimThumb`
- `packages/agent-ui/src/edge.ts`: `inspectorShown`
- `packages/hub/src/layout.ts`: `ownedBy`
- `packages/sync-protocol/src/routes.ts`: `SyncRouteName`
- `apps/server/src/auth/issue.ts`: `ELSEWHERE`; `apps/server/src/deck/loader.ts`: `DeckWarning`
- `runtime/opencode/plugin/decks-session.ts`: `DecksSession`
- `e2e/harness.mjs`: `openAllBoards`, `rangeOf`, `rangeOfAttr`

**Deduplicate**: `packages/canvas/src/lib/css-escape.ts` is imported by nothing, while
`packages/canvas/src/stage-ops.ts` and `packages/agent-ui/src/chat/Stream.tsx` each carry a private
copy of the same four-line `cssEscape`. Move the one in `lib/` to `@decks/ui` and have both use it.

**Decide: production code that only a test calls.** Each is either a public package API worth
keeping (then its test is its documentation) or code whose test is the only reason it exists.

- `packages/board-kit/src/ink.ts`: `moveStroke`, `inkHistory`, `inkCommit`, `inkUndo`, `inkRedo`
  (an undo history the app does not use: its undo is the `stage.pen.step` message to the server)
- `apps/server`: `sameWorkspace` (agents/workspaces), `readCliToken` (auth/cli-token),
  `forgetFfmpeg` (files/media), `renameStage` (stage/stage-admin), `WIDE_BOARD_W` (boards/templates)
- `packages/canvas`: `easeOutCubic` (camera/camera), `needsRedraw` (picture)
- `packages/agent-ui`: `distinctNames` (chat/tool-groups)
- `apps/web`: `embedUrl`, `pdfUrl` (lib/api), `keepRows` (panel/panel-groups)
- `packages/docs`: `applySplices` (merge), `storedZip` (server/fixtures)
- `runtime/paths.ts`: `SHIPPED`
- `packages/canvas/src/editor/core/fake-scene.ts` is a test helper living beside production code;
  rename to `fake-scene.test-helper.ts` the way `apps/server/src/stage/run-code.test-helper.ts`
  already does, so the convention is one.

### 3.4 Over-exported: 421 symbols exported but used only in their own file

Not dead, but noise: every `export` widens the surface a reader has to assume is depended on.
Counts per workspace: `apps/server` 71, `packages/canvas` 58, `apps/web` 23, `packages/docs` 14,
and a handful elsewhere. The fix is mechanical (drop the keyword) and safe (typecheck proves it).
Do it per package in one commit each, after the moves in §4, so the moves do not fight the diff.

The exceptions are the package entry points (`index.ts`, `public/*.ts`), where an export is the
API whether or not this repo uses it. `@decks/canvas` is explicitly "for any host", so its `public/`
exports stay.

### 3.5 CSS classes no markup uses

682 class names are declared across the app's and the canvas's sheets; 53 appear in no `.ts`,
`.tsx` or `.html` file, allowing for `prefix-${…}` construction. By sheet:

| sheet | classes |
|---|---|
| `packages/canvas/styles/canvas.css` (27) | `focus-bar-end focus-bar-over focus-bar-start focus-crumb focus-crumb-board focus-crumb-canvas focus-crumb-slash focus-exit focus-fill focus-fills focus-mode focus-page focus-scaled` (a focus mode that no longer exists), `pce-opt-code pce-opt-h1 pce-opt-h2 pce-opt-h3 pce-opt-quote pce-size-huge pce-size-large pce-size-small`, `source-area source-editor source-hint`, `bar-track`, `act-hold act-land` |
| `apps/web/src/styles/settings.css` (13) | `account-row set-add set-cue set-engine set-k set-mini set-pictures set-recogniser set-renderer set-row set-rows set-strip set-vol` |
| `packages/canvas/styles/chrome.css` (8) | `act-draw act-hold act-land lucide-search picker-google-hint set-k set-select set-zone` |
| `apps/web/src/styles/v3.css` (3) | `fps-tag menu-rule v3-app-icon` |
| `apps/web/src/styles/marks.css` (3) | `act-draw act-hold act-land` |
| `apps/web/src/styles/connections.css` (2) | `pair-code pen-bar` |
| one each | `composer.css: set-row`, `dock.css: lucide-chevron-down`, `forms.css: action-button`, `shell.css: panel-mark-name`, `properties.css: lucide-search` |

Before deleting, check the two ways the scan can be wrong: a class written by a board's own
HTML (`packages/board-host/lib`, `runtime/lib`) rather than the app, and a class an e2e check
asserts on. The `lucide-*` names come from the icon library's SVGs and are real; keep those. Each
sheet is its own commit with a baseline re-stamp, so the cascade diff shows exactly which rules
left and nothing moved.

### 3.6 Odds and ends

- `e2e/checks/apps.mjs` is not in `run.mjs`'s `CHECKS` list, so it never runs. Add it to the list
  or delete it; `run.mjs` says deleted checks "are in git, not gone".
- Stale comments name deleted modules: `board-admission.ts` in `e2e/checks/camera.mjs:367`,
  `sharper-pictures.mjs` in `e2e/backends-kit.mjs:3`. (The `mobile.mjs` mentions in `run.mjs`,
  `harness.mjs`, `README.md` and `DESIGN.md` are deliberate history and stay.)
- `apps/web/package.json` declares `@decks/stage`, `highlight.js`, `marked` and `mathjax-full`,
  which nothing under `apps/web` imports; `@decks/canvas` declares and uses all four. Remove them
  from the app and let `npm run build` prove it. (`@webgpu/types` and `@types/node` were flagged
  by the same scan but are referenced from `tsconfig.json` `types`, so they stay.)

## 4. Structure

### 4.1 `packages/canvas` (164 files, 33.9k lines)

What is wrong:

- **Two files carry a third of the package.** `Stage.tsx` is 2,395 lines: a 36-prop component with
  25 memos, 16 effects and a 256-line `frame` closure, holding camera wiring, wheel and zoom keys,
  finger tracking, live-page selection, media playback, board rendering and the browser checks'
  probes in one function. `stage/engine.ts` is 2,126 lines: one class whose regions, by keyword
  density, are worker bridge (lines 288–580), glide (646–690), layout (689–830), camera (826–1030),
  tiles (1029–1290), boards and their pictures (1288–1660), fonts (1679–1760), previews and ink
  (1764–1910), hit testing (1912–2100).
- **`src/pen/` is not about `@decks/pen`.** The package `@decks/pen` is the drawing file format.
  `canvas/src/pen/` is the drawing's UI: card editing and markdown, the properties and insert
  panels, icons, media, snapping, ink. The shared name makes every import ambiguous to read.
- **Twenty-four modules sit at the root** with no grouping: `held.ts`, `touch.ts`, `zoom-keys.ts`,
  `keycaps.ts` (input), `live-set.ts`, `live-placeholder.ts`, `thumb-budget.ts` (which boards get a
  page), `board-*.ts`, `frame-*.ts`, `plain-board.tsx` (the board frame), `redraw-queue.ts`,
  `spatial.ts`, `picture.ts` (engine support), and so on.
- **Nineteen `__decks*` globals** are written from nine files with ad hoc `(globalThis as {…})`
  casts: nine are measuring knobs read by the engine and camera, ten are probes the browser checks
  call. There is no single place to see them.

Proposed layout. Entry points (`index.ts`, `public/*`) and `camera/`, `editor/`, `lib/`, `state/`
do not move; the package's exports do not change.

```
src/
  index.ts  public/            unchanged: the API
  debug.ts                     NEW: every __decks* knob and probe, typed, in one object (§4.4)
  camera/  editor/  lib/  state/  device.ts  host.ts     unchanged
  stage/                       the Stage component and what only it uses
    Stage.tsx                  props, memos, JSX; target under 900 lines
    camera-wiring.ts           createCameraController call, origin/scroll bookkeeping, onWheel,
                               shortcut()                       ← Stage.tsx 263–350, 1286–1400
    fingers.ts                 touch(), beginTouch, held fingers, FrameGestureHost  ← 1417–1660
    live.ts                    liveChoice, liveFiles, shownBoards, markLiveCount
                               + live-set.ts, live-placeholder.ts, thumb-budget.ts, held.ts
    media.ts                   toggleMedia and the one playing element       ← 806–900
    probes.ts                  the __decksBoards/PenBox/FrameUnder/… functions, registered via debug.ts
    BoardCallout.tsx  board-slot.ts  plain-board.tsx  frame-host.ts  frame-messages.ts
  engine/                      ← stage/ today: the GPU side, renamed so "stage" means one thing
    engine.ts                  the class: lifecycle, worker bridge, setDoc/setBoards/setCamera/setView
    tiles.ts                   TileQueue: budget, takeTiles, warm, showAnyway, dropTileQueue
    pictures.ts                PictureStore: want/fit/fetch/stand-ins/retry/compressed, the byte budget
    fonts.ts                   FontLoader: need/prefetch/fetch/give/post
    hits.ts                    HitLayer: attachHits, writeHits, pickAll, onPath, linkAt, cardAt, scrollBy
    glide.ts                   startGlide and its clock
    render.worker.ts  backends/  types.ts  measure.ts  reader.ts  recovery.ts
    picture.ts  redraw-queue.ts  spatial.ts          ← from the root
  cards/                       ← pen/: a card's words
    CardEditor.tsx  card-frame.ts  card-syntax.ts  markdown.ts  math.ts  highlight.ts
    font-files.ts  font-coverage.ts  doc-index.ts
  items/                       ← pen/: how non-card items look and snap
    icons.ts  icon-index.ts  media-look.ts  MediaPlayer.tsx  look.ts  bounds.ts  snap.ts
    file-kinds.ts  board-files.ts
  panels/                      ← pen/: the chrome around the drawing
    PenBar.tsx  Properties.tsx  ColorPicker.tsx  Insert.tsx
  ink/                         existing, plus pen/ink.ts and pen/StageInk.tsx
  input/                       touch.ts  zoom-keys.ts  keycaps.ts
  board/                       board-host.ts  board-storage.ts  (the token and sandbox a board frame gets)
  comments/                    comment-text.ts
  drawing.ts  mount.tsx  extent.ts  stage-ops.ts       stay at the root: they are the package's verbs
```

How to split `engine.ts` without changing behaviour: extract **collaborators the engine owns**, not
mixins. `PictureStore` takes the `post` function and the budget facts and exposes `want`, `fit`,
`held bytes`; `TileQueue` takes `post` and the clock; `FontLoader` takes `post` and the font list.
The engine keeps its public method names (the browser checks and `apps/web` call them) and
delegates. Each extraction is one commit, proven by `npm run test:e2e -- one-picture tile-pixels
live-pictures zoom-out-pictures stage-goldens`, which are the checks that exercise those regions.
`pictures.ts` and `tiles.ts` get the unit tests their arithmetic has lacked, because they no longer
need a worker to construct.

How to split `Stage.tsx`: each extracted file exports one `create…(host)` function in the shape
`editor/index.ts` already uses (`createStageEditor(host)`), taking the signals it reads and returning
the signals it writes. Prop count stays at 36; nothing the app passes changes. The checks that
cover it: `stage-gestures`, `split-pinch`, `wheel-diagonal`, `glide`, `camera`, `media`,
`live-budget`, `context`.

### 4.2 `apps/web` (180 files, 32.0k lines)

What is wrong:

- **The design iteration's name is the code's name.** `src/v3/` holds the app's shell (TopBar,
  TopRight, ToolColumn, PenTray, ZoomBar, ChatSection, tooltip); `styles/v3.css` is 3,541 lines; 102
  `v3-*` class names and 104 `--v3-*` tokens. There is no v1 or v2 left. The name says "the third
  attempt" where it should say "the shell".
- **`v3.css` is an override layer, not a sheet.** Its header says it is "last in `index.css` … so a
  rule here wins a tie with the sheets it restyles". 97 of its 233 classes are also styled in another
  sheet: 26 in `panel.css`, 24 in the canvas's `chrome.css`, 18 in `shell.css`, 15 in `dock.css`,
  12 in `connections.css`. Its section comments are a changelog ("step 3: the side panel", "step 4",
  "step 6", "step 7"). A reader of `panel.css` cannot know what the panel looks like without reading
  a second file, which is exactly the problem `css:order` exists to catch.
- **`App.tsx` is 2,121 lines**, and 754 of them are one closure, `moreItems`, the overflow menu's
  item list; `mountFloat` and `mountToolsFloat` are another 225.
- **Directories that are now mostly shims**: `chat/` (18 of 34 files), `alerts/` (3 of 4), `ui/`
  (2 of 2), `camera/` (one 23-line file).
- Four `chrome/` components (Corner, ContextRing, NoticeStrip, PictureProgress) are shell pieces
  that happen to live apart from the shell.

Proposed layout:

```
src/
  index.tsx  App.tsx (target under 900 lines: wiring and JSX)
  app/                 existing controllers, plus
    menu.tsx           ← App.tsx moreItems (the overflow menu's items, as data + handlers)
    floats.ts          ← App.tsx mountFloat, mountToolsFloat
  shell/               ← v3/ + chrome/: TopBar TopRight ToolColumn PenTray ZoomBar ChatSection tooltip
                         Corner ContextRing NoticeStrip PictureProgress
  composer/            ← chat/composer/ + chat/Dialog.tsx; the chat/ shims are gone (§3.2)
  agents/  panel/  settings/  connections/  board/  markup/  canvas/  state/  lib/  perf/   unchanged
  settings/AlertSettings.tsx   ← alerts/ (its one real file)
  state/views.ts       ← camera/agent-views.ts
  pages/               shot.ts, measure.ts (the two extra Vite entry pages; vite.config.ts points here)
  styles/
    theme.css          ← v3.css lines 1–92: the `body` tokens, light and dark, renamed --ui-* (last)
    motion.css         ← v3.css 1665–2067: the motion system
    <feature>.css      each override from v3.css folded into the sheet that owns the class
```

Folding `v3.css` is the one part of this plan the cascade gate will fight, and that is the point:
do it **one target sheet at a time** (start with `panel.css`, 26 classes), move each overriding rule
to sit after the rule it overrides in the owning sheet, run `npm run css:order`, read which ties it
reports, re-stamp. Where a rule overrides a canvas sheet (`chrome.css`, 24 classes), the override
belongs in the app's sheet, not the package's: the canvas package is "for any host" and should not
carry the Decks shell's colours. Rename the `--v3-*` tokens last, as a pure rename commit, since a
rename changes every rule's hash and would hide a real move if combined with one.

### 4.3 `apps/server` (277 files, 50.7k lines)

Mostly out of this plan's scope: it is already organised by domain (`agents/`, `stage/`, `boards/`,
`deck/`, `verbs/`, `auth/`, `runtimes/<name>/`), its `migrations/` are dated and documented as
run-on-read, and `studio/` is a single well-described module. Two files invite the same treatment as
the canvas's: `agents/session.ts` (2,152 lines) and `runtimes/claude/backend.ts` (1,712). Leave them
for a separate pass with their own design; this one takes only the dead exports from §3.3 and the
over-exports from §3.4.

### 4.4 Measuring knobs and test probes: one registry

Today a knob is `(globalThis as { __decksHalfZoom?: boolean }).__decksHalfZoom` written where it is
read, and a probe is a function assigned to `globalThis` from inside the `Stage` component body.
Proposal: `packages/canvas/src/debug.ts`:

```ts
/** What the browser checks and the profiling scripts reach from outside; nothing else reads this. */
export const knobs = { halfZoom: true, pinchTail: false, exactBoardCamera: false, tileBudget: …, pictureMB: …, picturesPerFrame: 1, skipLevels: …, tilePixels: false, warm: … };
export const probes: { boards?(): …; cameraTransform?(): string; penBox?(id: string): DOMRect | undefined; frameUnder?(…); pictureAt?(…); cardAt?(…); sheet: SheetStats; engine?: StageEngine; … } = { sheet: { shown: 0, tiles: 0 } };
Object.assign(globalThis, { __decksKnobs: knobs, __decksProbes: probes });
```

The checks and `scripts/ipad-profile.mjs` change from `__decksBoards()` to `__decksProbes.boards()`
in one commit alongside; 19 names become 2, with one type each. `apps/web/src/perf/probe.ts` keeps
its `?probe=` gate and reads from the same object.

### 4.5 `packages/stage`, `e2e`, `scripts`

- `pkg/` and `pkg-gl/` (11 MB of built wasm) are committed on purpose so building the app needs no
  Rust; keep that. Note for later: each rebuild adds 4–7 MB to history; if rebuilds become frequent,
  CI-built artifacts or Git LFS are the escape.
- The Rust crates were not checked for dead code here (no `cargo check` in this sandbox). Run
  `cargo build --release --target wasm32-unknown-unknown -p stage-web 2>&1 | grep warning` on the
  owner's machine; the crates declare no `#[allow(dead_code)]`, so warnings are the truth.
- `e2e/` and `scripts/` are clean apart from §3.6. `KNOWN-FAILURES.md` is current.

### 4.6 Decks Studio, the other host

`DotIN13/decks-studio` vendors this repository as a git submodule (`vendor/decks`, tracking
`studio-canvas`, pinned at `c4f12da` of 2026-10-21, 213 commits behind the tip at the time of
writing) and lists thirteen of its packages as workspaces. It never builds or imports `apps/web`.
What it reaches:

- **Styles:** one import, `@decks/canvas/canvas.css`, the `dist/canvas.css` that
  `scripts/build-css.mjs` compiles from `styles/standalone.css` (chrome, stream, canvas, ink,
  markdown, properties, tokens, host) and scopes under `:where(.decks-canvas, .decks-layer)` in a
  `decks` layer. `v3.css` is not in that list, so Studio has always seen the package sheets
  **without** the app's 55 overrides of their classes (24 in `chrome.css`, 9 in `stream.css`, 8 in
  `properties.css`, 7 in `ink.css`, 6 in `canvas.css`, 1 in `host.css`). Studio restyles 23 of those
  classes itself, from its own `packages/ui/src/styles.css`.
- **Code:** the package entry points only: `@decks/canvas`, `/comments`, `/tools`,
  `@decks/agent-ui/chat`, `/composer`, `/alerts`, `/vite`, `@decks/ui/float`, and `@decks/pen`,
  `/protocol`, `/hub`, `/sdk`, `/sync-*`, `/board-host`. No deep import into any `src/`, no path
  alias, no `__decks*` global.

So the plan's effect on Studio comes down to two rules, both already in §4.2 and §3.5 and worth
stating as constraints:

1. **Fold `v3.css` into the app's sheets, never into the package's.** An override of `.pill` or
   `.btn` belongs in `apps/web/src/styles/shell.css` (or whichever app sheet owns that surface), not
   in `packages/canvas/styles/chrome.css`. Moved into the package, those 55 rules would ship to
   Studio in its next `dist/canvas.css` and change its look. Moved into the app, Studio sees exactly
   what it sees today. The scoping in `build-css.mjs` makes this easy to check: anything that lands
   in `dist/canvas.css` is Studio's; anything that does not is the app's alone.
2. **The 53 dead classes are safe to delete.** None of them appears in Studio's markup or styles
   (checked against every `.ts`, `.tsx`, `.html` and `.css` outside `vendor/` and `node_modules/`).
   The 41 package-sheet class names Studio's markup does use (`pill`, `float`, `stream`, `row`,
   `title`, …) are all live in this repository too and are not touched.

The canvas layout moves in §4.1 (`pen/` to `cards/`, `stage/` to `engine/`, the `Stage.tsx` and
`engine.ts` splits) change nothing Studio imports, because the package's `exports` map is kept as
it is. The one Studio-side chore is the ordinary one: bump the submodule, run `npm install` (its
`postinstall` rebuilds `dist/canvas.css`), and look at the canvas once. Doing that bump before
Phase 4 rather than after would separate "213 commits of feature work" from "the reorganization" in
what Studio sees.

## 5. Guardrails, so it stays clean

1. **A dead-export gate in CI.** The scan behind §3.3 (§7 says how it works) is forty lines; write
   it as `scripts/dead-exports.mjs` beside `css-order.mjs`, with the same shape
   (exit 1 naming each symbol, an allowlist for the `public/` entry points), and add it to
   `test.yml`. The off-the-shelf alternative is `knip`, which understands workspaces and would also
   report unused dependencies and files; it could not be run in this sandbox, so it is untested here.
2. **A dead-CSS gate**, the same way: the class scan from §3.5 as `scripts/dead-css.mjs`, with an
   allowlist for `lucide-*` and anything a board's own HTML writes.
3. **`.gitignore`**: `/_scratch/`, and a comment saying scratch work goes there.
4. **`CONTRIBUTING.md`**: the move-the-importers rule from §3.2; "name a directory for what it
   holds, not when it was made" (no more `v3/`); knobs and probes go through `debug.ts`.

## 6. Sequence

Each line is a commit or a short run of them. Each leaves `npm run typecheck`, `npm test` and
`npm run css:order` green; the browser checks named are the ones to run for that step.

**Phase 0: hygiene** (an hour)
1. Remove `_scratch/`, ignore it, rotate the pairing code. (§3.1)
2. `apps.mjs`: list it or delete it. Fix the two stale comments. (§3.6)
3. Drop the four unused dependencies from `apps/web/package.json`; `npm run build`. (§3.6)

**Phase 1: dead code** (a day)
4. Delete the 12 zero-importer shims. (§3.2)
5. Repoint and delete the remaining 15 shims, `ui/icons.tsx` last as its own commit. (§3.2)
6. Delete the unreferenced exports, one commit per workspace. (§3.3)
7. Decide the tests-only exports; delete or keep each with a line saying why. (§3.3)
8. Unused CSS, one sheet per commit, baseline re-stamped each time. Checks: `chrome`, `panel`,
   `shell`, `selection`, `card-editor`. (§3.5)

**Phase 2: the registry** (half a day)
9. `debug.ts`; checks and `ipad-profile.mjs` updated in the same commit. Checks: everything that
   reads a probe: `camera`, `stage-gestures`, `one-picture`, `drop-lands`, `card-editor`,
   `pen-stage`, `tile-pixels`. (§4.4)

**Phase 3: `packages/canvas` layout** (two to three days)
10. Rename `src/stage/` to `src/engine/`; move `picture.ts`, `redraw-queue.ts`, `spatial.ts` in.
11. Split `src/pen/` into `cards/`, `items/`, `panels/`, and fold its ink into `ink/`.
12. `input/`, `board/`, `comments/`; the root is down to the package's verbs.
13. Extract `engine/pictures.ts` (the largest and most self-contained region). Checks: `one-picture`,
    `live-pictures`, `zoom-out-pictures`, `placeholder`.
14. Extract `engine/tiles.ts`. Checks: `tile-pixels`, `stage-goldens`, `render-perf` (measure only).
15. Extract `engine/fonts.ts` and `engine/hits.ts`. Checks: `text-shots`, `selection`, `item-pill`.
16. Create `stage/` and move the Stage-only modules in; then extract `fingers.ts`,
    `camera-wiring.ts`, `live.ts`, `media.ts`, `probes.ts`, one each. Checks: `stage-gestures`,
    `split-pinch`, `wheel-diagonal`, `glide`, `camera`, `media`, `live-budget`, `context`.
17. Drop the over-exports in the package. (§3.4)

**Phase 4: `apps/web` layout** (two days)
18. `v3/` + `chrome/` to `shell/`; `chat/composer/` to `composer/`; `alerts/`, `camera/`, `ui/`
    dissolved; `pages/`. Pure moves; typecheck proves them.
19. `App.tsx`: extract `app/menu.tsx` and `app/floats.ts`. Checks: `chrome`, `shell`, `panel`.
20. Fold `v3.css` into its targets, one target sheet per commit, starting with `panel.css`;
    `theme.css` and `motion.css` are what remains. Overrides of package classes go into app
    sheets, never into `packages/canvas/styles/` (§4.6). Checks: `chrome`, `panel`, `panel-steady`,
    `shell`, `stages`, `card-phone`. (§4.2)
21. Rename `--v3-*` tokens to `--ui-*` and `v3-*` classes to `shell-*`, as a pure rename.
22. Drop the over-exports in the app and the server. (§3.4)

**Phase 5: guardrails** (half a day)
23. `scripts/dead-exports.mjs`, `scripts/dead-css.mjs`, both in `test.yml`. (§5)
24. `CONTRIBUTING.md` and `.gitignore`. (§5)

Phases 1 and 2 can go in any order and in parallel with each other. Phase 3 before Phase 4 only
because the canvas moves change import paths the app uses; doing the app first would mean
touching the same imports twice.

## 7. How the inventory was made

Three scans over `git ls-files`, excluding `_scratch/`, vendored `lib/` folders and `.bundle.` files:

- **Dead exports**: for every `export (function|const|let|class|interface|type|enum) Name`, count
  whole-word references to `Name` in every other tracked text file, and in its own file. Zero
  elsewhere and one at home is dead; zero elsewhere and more at home is over-exported; references
  only from `*.test.*` or `.md` is "tests only".
- **Orphan files**: a source file whose basename or stem appears in no import, no `from "…"`, no
  HTML `src`, no JSON and no script. Found `shared-board.ts`, `swipe-close.ts`, `css-escape.ts`
  and the orphan e2e check; `Corner.tsx` was a false hit (its name is an ordinary word) and is used.
- **Dead CSS**: every `.class` token in the app's and packages' sheets (comments stripped) against
  every `.ts`, `.tsx` and `.html`, accepting a class whose `stem-` prefix is built in code.

The scans are heuristics; §3 says where each can be fooled. Everything else in §4 is from reading
the files: `Stage.tsx` and `engine.ts` were outlined by their top-level declarations and by keyword
density per 200 lines, `v3.css` by its section comments and the overlap of its class names with the
other sheets.
