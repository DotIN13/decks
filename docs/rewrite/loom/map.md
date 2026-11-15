# The move of the canvas libraries: the map

Written 2026-11-14 by Loom, on branch `rewrite` at `78e3f78d`, before anything moves. Phase 2 follows
this file once Mason says the switch-over has landed. Every number below was measured on that commit
(scripts in section 9).

What moves: `packages/canvas`, `card-host`, `ink` and the page half of `docs` to `canvas/`;
`packages/pen` to `pen/`; `packages/ui` to `ui/`; `packages/stage` to `engine/`. Behaviour, markup
and class names stay. This is a move and a split, not a rewrite.

## 0. What the map rests on

- **Package names stay, folders move.** `@decks/pen`, `@decks/ui` and `@decks/canvas` keep their
  names, so the 200 + 148 + 181 imports by name need no rewrite: npm finds a workspace by its name,
  not its folder. Only paths written as paths change (section 3). `@decks/stage` becomes
  `@decks/engine` (the word `stage` is retired outside the engine's crates), `@decks/ink`,
  `@decks/card-host` and `@decks/docs` fold into `@decks/canvas` and stop existing.
- **No `src/` level.** The new folders keep their files at the top, as `server/` and `harness/` do:
  `packages/pen/src/ops.ts` becomes `pen/ops.ts`. Files inside a package move together, so their
  relative imports to each other do not change.
- **Rule 3 entries are the package's `exports`.** `tools/gates/imports.mjs` counts every target of
  `exports` as an entry, so `@decks/canvas/camera` stays a legal door. Each move rewrites `exports`.

## 1. Every file's new place

### pen/ (from packages/pen, 29 files, a pure rename)

`packages/pen/src/<f>` → `pen/<f>` for all 26 source and test files; `package.json`, `tsconfig.json`
to `pen/`; a new `pen/README.md`. Exports `"." : "./index.ts"`. Rule: imports `protocol/` at most;
today it imports nothing, so it already holds.

### ui/ (from packages/ui, 17 files, a pure rename)

`packages/ui/src/<f>` → `ui/<f>`, `float/` kept as `ui/float/`. Exports `"."`, `"./float"`,
`"./agent-marks"`. Rule: `protocol/` at most. `agent-marks.tsx` imports `AgentKind` from today's
`@decks/protocol`; the new `protocol/chat.ts` exports the same name, so after the switch-over the
same specifier resolves to the new protocol. Holds.

### engine/ (from packages/stage, 120 tracked files)

`packages/stage/*` → `engine/*` whole: `crates/` (9 crates, Anvil works in `crates/apple`),
`Cargo.toml`, `Cargo.lock`, `build-web.sh`, `fetch-fonts.mjs`, `demo/`, `fonts/`, `.gitignore`.
Package renamed `@decks/stage` → `@decks/engine`. `pkg/` and `pkg-gl/` (8 built files) leave git
(rule 10, section 5). Rule: `protocol/` at most; it imports nothing. Holds. The crates keep the word
`stage` in their own names (`stage_web`, `stage-shot`): the glossary exempts them.

### canvas/ (from packages/canvas 185 source files, card-host, ink, docs/page)

Folders named by what a reader looks for. `stage` is renamed wherever it is a file name.

| canvas/ folder | what it holds | from |
|---|---|---|
| `index.ts`, `types.ts`, `theme.ts`, `debug.ts` | the entry and shared types | `src/index.ts`, `src/types.ts`, `src/theme.ts`, `src/debug.ts` |
| `entries/` | the package's other doors: camera, comments, tools, host | `src/public/*` |
| `view/` | the canvas element: its layers and the selection | `src/stage/Stage.tsx` → *view/CanvasView.tsx*, `src/stage/items-layer.tsx`, `src/stage/selection.tsx` |
| `camera/` | where the canvas looks, glides, insets, landing, agents' views | `src/camera/*`; `stage-ops.ts` → `view-calls.ts` (and its test) |
| `input/` | pointer, wheel, touch and keys, before they mean an edit | `src/stage/input.ts`, `src/edit/dom/pointer.ts`, `src/edit/dom/keys.ts`, `src/edit/dom/touch-rules.ts` (+test), `src/items/input.ts` → *input/item-keys.ts* |
| `editor/` | the TypeScript editor: gestures, ops, overlays, text | `src/editor.tsx` → `editor/editor.tsx`; `src/edit/index.ts`, `held.ts`, `pen-tools.ts`, `snap.ts`, `scene-ts.ts` and tests → `editor/`; `src/edit/core/*` → `editor/core/*`; `src/edit/dom/{controller,effects,OverlayLayer,TextEditing,colours}` → `editor/dom/` |
| `drawing/` | the drawing as the page holds it | `src/model/{drawing,boxes,bounds,layers,doc-index,comment-text}` (+tests) |
| `items/` | what sits on the canvas and when it wakes | `src/items/{awake,item-slot,item-surfaces,MediaPlayer,missing,natural-size,news}` (+tests), `src/model/{file-drop,file-kinds}` (+test) |
| `cards/` | cards: mounting, reading, pictures, the card editor | `src/items/{card,card-load,card-reading,card-snapshot,card-surface}` (+tests), `src/cards/CardEditor.tsx`, `src/model/{card-frame,card-syntax,markdown}` (+tests) |
| `cards/runtime/` | what a card needs to run anywhere | `packages/card-host/src/*` → `cards/runtime/*`, its test; `lib/` (112 files) built, section 5 |
| `documents/` | files you type into, drawn as pages | `packages/docs/src/page/*` → `documents/*`; `docs/src/client.ts`, `merge.ts` (+tests) → `documents/`; `docs/src/index.ts` → `documents/model.ts`; `docs/src/gdoc/{types,units}.ts` → `documents/google/` |
| `ink/` | Pencil strokes: shaping, the ink layer, the tray keys | `packages/ink/src/ink.ts` (+test) → *ink/shaper.ts*; `src/ink/StageInk.tsx` → *ink/InkLayer.tsx*; `src/ink/{ink,ink-keys}.ts`; `src/model/ink.ts` → `ink/model.ts` |
| `render/` | the engine's page side and its worker | `src/render/*` (`engine.ts` keeps its role, split in section 2) |
| `look/` | fonts, icons, code colours, maths, media | `src/look/*` |
| `chrome/` | the canvas's own controls: properties, insert, pen bar | `src/ui/*` (Pane's lane today) |
| `host/` | the canvas inside a frame, and the page that holds the frame | `src/host.ts`, `src/host-pass.test.ts`, `src/frame/protocol.ts` → *host/messages.ts*, `src/frame/chrome.ts`, `src/frame/inside/*` → `host/inside/`, `src/frame/outside/host.tsx` → *host/outside/framed-editor.tsx* |
| `styles/` | the canvas surface sheets | `styles/*` (+ `ink.css`), `canvas.css` split by part (section 2) |
| `scripts/` | `build-css.mjs` | `scripts/build-css.mjs` |

Not moved, deleted by the switch-over (the server half, replaced by `server/documents`):
`packages/docs/src/server/*`, `gdoc/{plan,markdown,fake,gdoc.test,index}.ts`, `converge.test.ts`.
`documents/` must not need them: today the page imports only `client`, `merge`, `index`,
`gdoc/types`, `gdoc/units`. Confirmed by grep.

Exports of `@decks/canvas` after the move: `"."`, `"./camera"`, `"./tools"`, `"./host"`,
`"./comments"`, `"./card"`, `"./card-reading"`, `"./ink"` (for `harness/page/frame/PenTray.tsx`),
`"./cards-runtime"` (for `server/main.ts` via the frame feature and `examples/share-site`),
`"./styles/*"`, `"./styles.css"`, `"./surface.css"`.

**Rule each move must satisfy** (section 6, rule 3: `canvas/` imports `engine/`, `pen/`, `ui/`,
`protocol/`, nothing above). Today `packages/canvas` breaks it three ways, all to be cut before
`packages/` can go (section 5, first row):

1. `@decks/protocol` (old, 37 imports in 37 files): `Camera` (27), `Page` (19), `Presence`,
   `PresenceBy`, `ServerMessage`, `LineClientMessage`, `StageCall`, `ChangeAuthor`. The new
   `protocol/` has `Camera` (as a schema, with no `export type Camera` yet), `ServerMessage`,
   `AgentKind`; it has no `Page`, `Presence`, `PresenceBy`, `LineClientMessage`, `StageCall`,
   `ChangeAuthor`.
2. `@decks/api` `cardCalls` (`frame/inside/card-calls.ts`): the calls a card may make. The new
   protocol says it with `who: ["card"]` on each call; no helper exists yet.
3. `@decks/hub/follower` (`frame/inside/studio-line.ts`, baselined): a server package. The follower is
   browser code (185 lines, imports only `@decks/pen` and `sync-protocol`'s `Changes`, `LiveEvent`,
   which `protocol/sync.ts` has).

## 2. Each split

30 TypeScript, TSX and CSS files over 400 lines move here (17 of them plus `canvas.css` in
`packages/canvas`; 3 in docs' page half; 2 pen; 2 ui; 1 ink), and 11 Rust files in the engine.
`render.worker.ts` is exactly 400: not over. A split keeps every exported name exported from the
same import path the outside uses (through the folder's entry), so importers do not change.

Where a file is a part of the page (a Solid component or a `create…` closure with DOM), it becomes
**model** (state and rules, no DOM, unit-tested), **view** (`.tsx`, markup only) and **actions**
(what a press or a message does). Where it is pure logic, it splits by topic.

### canvas: page parts (model, view, actions)

| today (lines) | becomes |
|---|---|
| `render/engine.ts` (2480; one class `StageEngine` 2263) | `render/engine.ts` (the class, under 400: open, draw, dispose, delegating), *render/engine-doc.ts* (setDoc, laidOut, laidOutWhole, layout diffs), *render/engine-camera.ts* (setCamera, beginGlide, carry), *render/engine-tiles.ts* (takeTiles, drawUnguarded, withOutlines), *render/engine-cards.ts* (setCards, wantCardPictures, fitPictures, fetchPicture, showPreview), *render/engine-fonts.ts* (fetchFonts, font needs), *render/engine-hits.ts* (writeHits, pick), *render/engine-worker.ts* (receive, startWorker, readCompressed). The class becomes `CanvasEngine`. Not model/view/actions: no DOM of its own. |
| `cards/CardEditor.tsx` (1469; `CardEditor` 1384) | `cards/editor/model.ts` (the block model: block, inline, outList, outBlock, splitAround, restyle, style, setBlock), *cards/editor/markup.ts* (out: blocks to HTML), `cards/editor/view.tsx` (the component and its bar: showBar, lineSlot), `cards/editor/actions.ts` (onInput, onPaste, onKeyDown, onPointerMove, endDrag) |
| `chrome/Properties.tsx` (1248; `Properties` 891) | `chrome/properties/model.ts` (what the selection's fields read and set: setBox, align, distribute), `chrome/properties/view.tsx` (the panel, sections as small components: Layout, Fill, Stroke, Text, Effects), *chrome/properties/fields.tsx* (NumField, ColorField, Swatches), `chrome/properties/actions.ts` (each field's change into ops) |
| *view/CanvasView.tsx* (937; `Stage` 758) | `view/model.ts` (StageProps → `CanvasViewProps`, derived state, coloursFor), *view/CanvasView.tsx* (markup and layers), `view/actions.ts` (the camera controller wiring `ctl`, input wiring), *view/editor-wiring.ts* (the 121-line `editor` block) |
| `input/pointer.ts` (899; `createPointer` 766) | `input/pointer/model.ts` (PageView, hit rules, tap-to-deselect rules), `input/pointer/actions.ts` (onPointerDown, follow, onHover, onDblClick), `input/pointer/touch.ts` (touchOnDrawing 120, split into its press, hold and drag), `input/pointer/index.ts` (`createPointer` assembling them) |
| `cards/card.ts` (759; `mountCard` 152) | *cards/mount.ts* (mountCard, in three: load, run scripts, wire), *cards/sheet.ts* (cardSheet, clean, asDocument), `cards/parts.ts` (cardMath, cardMermaid, drawParts), *cards/imports.ts* (deckImports, giveDeckImports), `cards/context.ts` (CardContext, wordsSelectedInCards) |
| `view/items-layer.tsx` (753; `createItemsLayer` 704) | `items/layer/model.ts` (slots, rendered, liveFiles, playingBox), `items/layer/view.tsx` (pageNode, fileNodes, player), `items/layer/actions.ts` (mount and unmount on awake changes) |
| *ink/InkLayer.tsx* (703; `StageInk` 668) | `ink/layer/model.ts` (the stroke in progress, paintInk's maths), `ink/layer/view.tsx`, `ink/layer/actions.ts` (onDown, onMove, onUp) |
| `editor/core/gesture.ts` (693) | `editor/core/gesture.ts` (types, `step` under 80), *editor/core/gesture-carry.ts* (carry, moveCarry, releaseCarry), *editor/core/gesture-handle.ts* (pressHandle, move, release), *editor/core/gesture-press.ts* (pressCanvas) |
| *input/canvas-input.ts* (from `stage/input.ts`, 686; `createStageInput` 619) | *input/keys-shortcuts.ts* (keydown, shortcut), *input/wheel.ts* (onWheel), `input/touch.ts` (touch, beginTouch, panFrom, KeptTouches), `input/index.ts` (`createCanvasInput` assembling them) |
| *host/outside/framed-editor.tsx* (659; `createFramedEditor` 494) | `host/outside/model.ts` (FrameHostOptions, the handle's state), *host/outside/frame-life.ts* (startFrame, renew), `host/outside/wire.ts` (wire), *host/outside/in-step.ts* (keepInStep 108, in two), `host/outside/view.tsx` (surface) |
| `drawing/drawing.ts` (575; `createDrawing` 358) | `drawing/drawing.ts` (Drawing, createDrawing assembling), *drawing/pages.ts* (pagesOf, pagesAhead, together, onTop), *drawing/edits.ts* (edit, step, flush), *drawing/receive.ts* (receive, follow) |
| `editor/core/overlay.ts` (546) | `editor/core/overlay.ts` (Overlay, deriveOverlay), *editor/core/outlines.ts* (selectionOutlines, kinOutlines, hover), `editor/core/measure.ts` (measure) |
| `camera/controller.ts` (489; `createCameraController` 450) | `camera/controller.ts` (assembling), *camera/controller-write.ts* (write, settled), *camera/controller-motion.ts* (coast, glideTo, wheel, scrolled) |
| `editor/dom/TextEditing.tsx` (482) | `editor/dom/text/model.ts` (createTextEditing's state), `editor/dom/text/view.tsx` (TextEditor), `editor/dom/text/actions.ts` |
| `view/selection.tsx` (451; `createSelection` 389) | `view/selection/model.ts`, `view/selection/view.tsx` (pills 135, in two), `view/selection/actions.ts` |
| `editor/dom/OverlayLayer.tsx` (430; one component 396) | `editor/dom/overlay/view.tsx` (markup), `editor/dom/overlay/model.ts` (what each outline, handle and guide draws), *editor/dom/overlay/handles.tsx* |
| `styles/canvas.css` (1699) | one sheet per part, beside the part: `view/canvas.css`, *editor/dom/overlay.css*, `chrome/properties.css`, *chrome/menus.css*, `cards/card.css`, *items/items.css*, *host/frame.css*, kept under 400 each, same selectors, same `@layer decks.surface`; the layer order decides, not file order (rule 10). `cascade-order.json` is regenerated, not edited. |

### docs' page half

| today (lines) | becomes |
|---|---|
| `documents/page.ts` (1750; `mountDocPage` 1270, `STYLE` 348) | `documents/page/model.ts` (state, updated, refresh), `documents/page/view.ts` (drawPages, drawChanges, drawComments, drawHistory, showPill), `documents/page/tools.ts` (buildTools, buildGoogleTools, gpressed), `documents/page/actions.ts` (openVersion, compiled, drawGit, drawGoogle, signInParts, stop), *documents/page/page.css* (the 348-line `STYLE` string, as a scoped sheet), `documents/page/icons.ts` (ICON) |
| `documents/live.ts` (2052; `Builder` 792, `LiveEditor` 1078) | *documents/live/builder-inline.ts* (inlineMd, emphasis, inlineTex), *documents/live/builder-block.ts* (line, texLine, block, float, table), *documents/live/editor.ts* (LiveEditor's state and render), *documents/live/editor-input.ts* (beforeInput, enter, keydown, pressed, toggle, link), *documents/live/editor-blocks.ts* (setBlock, codeBlock, apply), *documents/live/editor-view.ts* (drawWidgets, highlight, offsetAt, pointAt, reveal) |
| `documents/gview.ts` (2090; `GoogleView` 1694) | `documents/google/view.ts` (load, render, paginate, splitAt), *documents/google/paragraph.ts* (paragraph 87 in two, object, runsOf), `documents/google/geometry.ts` (indexAt, pointAt), *documents/google/edit.ts* (replace, join, input, copy, key, shortcut), `documents/google/history.ts` (apply, applyLocal, inverseOf, perform), `documents/google/units.ts` (Unit, buildUnits, applyText, cellStyle, numeral, shiftStep) |

### pen, ui, ink

| today (lines) | becomes |
|---|---|
| `pen/html.ts` (704; `Writer` 494) | `pen/html.ts` (toHtml, HtmlOptions), *pen/html-writer.ts* (Writer: element, place, layer), *pen/html-paint.ts* (outline, svgPaint, conic, gradients), *pen/html-tailwind.ts* (tailwindClass) |
| `pen/layout.ts` (418; `layout` 212) | `pen/layout.ts` (layout, under 80, calling), *pen/layout-frame.ts* (frameContent and flex placement), *pen/layout-text.ts* (estimateText, text sizes) |
| `ui/float/float.ts` (585; `makeFloat` 462) | `ui/float/float.ts` (makeFloat assembling), *ui/float/drag.ts* (onPointerDown, endDrag, onTabMove), `ui/float/place.ts` (settle, restore) |
| `ui/float/float-math.ts` (402) | `ui/float/float-math.ts` (settle, avoid, toFraction), *ui/float/stowed.ts* (loadFloats, loadStowed) |
| *ink/shaper.ts* (420; `inkShaper` 112) | *ink/shaper.ts* (inkShaper in two: grow, finish), `ink/outline.ts` (outline, simplify, inkBounds) |

### engine (Rust; functions are not measured in Rust)

| today (lines) | becomes |
|---|---|
| `crates/web/src/engine.rs` (2484, 97 fns) | `engine.rs` (Page, Camera), *page_edits.rs* (apply, undo, redo, apply_edits, reroute_after), *page_layout.rs* (lay_out, layout_json, layout_changes, root_json, card_json), *page_fonts.rs* (font_needs*), *page_pick.rs* (pick, pick_all, within, carried_frame), *pictures.rs* (Pictures), the rest by topic, each under 400 |
| `crates/paint/src/painter.rs` (1173) | `painter.rs` (Context, paint_area, open, close), *paint_fill.rs* (fills_of, paint_of, color, fade), *paint_effects.rs* (shadows, inner_shadows, layer_blur, opacity), *paint_stroke.rs* (Stroke, stroke_of, dash_of, shape_stroke, path_ops), *paint_ink.rs* (LiveInk, paint_ink), *paint_marks.rs* (placeholder_mark, arrow_label, card_paper) |
| `crates/web/src/bind.rs` (1136, 120 fns) | `bind.rs` (start, GpuHandle), *bind_page.rs* (PageEngine), *bind_render.rs* (the render worker's engine), *bind_io.rs* (copy_in*, reader, typesetter, parse_edits, ids, key) |
| `crates/gpu/src/tests.rs` (650) | *tests/effects.rs*, *tests/words.rs*, *tests/goldens.rs*, *tests/bench.rs* |
| `crates/doc/src/lib.rs` (599) | `lib.rs` (Document core), *node.rs* (Node, Handle), *json.rs* (from_json, to_json, node_json), *change.rs* (Change, Applied, DocError) |
| `crates/shot/src/lib.rs` (578) | `lib.rs` (Request, Needs, Picture), *shooter.rs* (Shooter), *encode.rs* (unpremultiply, encode, request_of) |
| `crates/text/src/card.rs` (544) | `card.rs` (layout, Card), *card_setter.rs* (Setter: para, place, stack, one), *card_table.rs* (table), *card_marks.rs* (Palette, ink, mark, alert, roman, marker) |
| `crates/scene/src/lib.rs` (516) | `lib.rs` (Scene), *rect.rs* (Rect), *root.rs* (Root, Updated, Hit), *blur.rs* |
| `crates/scene/src/layout.rs` (432) | `layout.rs` (Ctx, place, layout), *layout_size.rs* (sizing, size_of, text_size, Estimate) |
| `crates/text/src/lib.rs` (431) | `lib.rs` (Text, Font, Span), *lay.rs* (lay, chain, style_key) |
| `crates/gpu/src/lib.rs` (401) | `lib.rs` (Gpu, Api), *spares.rs* (warm, forget_to_spare, texture_from_spare, make_spares) |

`crates/apple` is Anvil's and not split by Loom. Rust splits are behaviour-neutral by construction
(`cargo test` for the crate under the heavy lock, then the goldens check).

### Functions over 80 lines

78 TypeScript functions over 80 lines move here (counted by the size gate's own parser; the server
half of docs excluded). Most are the closures above and disappear with their file's split. The rest,
each split into named helpers in the same file:

| function (lines) | split into |
|---|---|
| `camera/insets.ts` `watchInsets` (163) | measure, observe, publish |
| `camera/view-calls.ts` `runStageCall` (104) | `runViewCall` with one handler per call in a table |
| `editor/core/overlay-json.ts` `overlayJson` (87) | outlines, handles, guides |
| `editor/dom/controller.ts` `createEditor` (247) | model / actions, as a part |
| `editor/dom/effects.ts` `createEffects` (173) | one effect per function |
| `editor/editor.tsx` `createEditor` (310) | `editor/model.ts`, `editor/actions.ts`, `editor/editor.tsx` |
| `host/inside/*`: `openFrame` 221, `wireFrame` 275, `run` 139, `editorOptions` 131, `installHost` 123, `installPresence` 127, `installClipboard` 96, `createBackend` 90, `createStudioLine` 87, `openLine` 85 | each into its steps (boot, line, calls, events, presence), one helper per message kind |
| `items/MediaPlayer.tsx` (243), `items/card-surface.tsx` `CardSurface` (229), `items/item-slot.tsx` `ItemSlot` (201), `items/item-surfaces.tsx` `AppSurface` (95) | model / view / actions each |
| `chrome/*`: `PageCallout` 305, `ColorPicker` 189, `Insert` 170, `createInsertMenu` 143, `InkBar` 117, `PenBar` 95, `AgentCursor` 83 | model / view / actions each; the bars share one tray model |
| `drawing/markdown.ts` (`runsOf` 103, `blocksOf` 81), `render/render.worker.ts` `take` (72, under) | by token kind |
| `ui/Popover.tsx` `Popover` (268), `ui/agent-marks.tsx` `AgentMark` (118), `ui/scribble.tsx` `ScribbleCatch` (143) | model / view each |
| `pen/diff.ts` (`editDocument` 86, `diff` 85), `pen/geometry.ts` `pathBounds` (117), `pen/ops.ts` `one` (101), `pen/outline.ts` `mapped` (81), `pen/layout.ts` `frameContent` (94) | by case: one helper per op or path command |
| `documents/tex.ts` `texMeta` (89), `documents/page` `buildGoogleTools` (91) | by field |

The full list, file by file, is in section 9.

## 3. What imports what today, and the rewrites the move needs

Counted with `.scratch` scripts over `git ls-files` (built files, `node_modules`, the lockfile excluded).

| package | imports by name today | after the switch-over (apps/, old packages gone) | specifier rewrites |
|---|---|---|---|
| `@decks/pen` | 200 (canvas 92, apps/server 27, server 21, hub 10, ...) | canvas, server, harness, tools, examples | **0**: name kept |
| `@decks/ui` | 148 (harness 56, apps/web 42, canvas 18, agent-ui 13) | canvas, harness | **0**: name kept |
| `@decks/canvas` | 181 (harness 68, apps/web 63, docs 23, ...) | harness, examples, Studio | **0**: name kept; `exports` rewritten |
| `@decks/stage` | 20 (canvas 9, apps/server 5, ...) | canvas 9, scripts 1, examples 1, Studio 1 | **13** → `@decks/engine` (+3 `package.json`) |
| `@decks/ink` | 12 (canvas 4) | canvas 4, harness 1 | **5**: canvas's 4 become relative, `harness/page/frame/PenTray.tsx` → `@decks/canvas/ink` |
| `@decks/card-host` | 21 | canvas 1, examples 2, scripts 1 (`public-entries.test`) | **4** → relative or `@decks/canvas/cards-runtime` |
| `@decks/docs` | 45 (apps/server 15, docs itself 8) | canvas 2 | **2**: `@decks/docs/page` → relative `../documents/...` |
| relative, inside `packages/canvas/src` | 501 | | recomputed by the script for the folder reorganisation (step 4e); about 340 change |
| relative, inside `packages/docs/src/page` | 35 | | about 12 change (to `model.ts`, `google/`) |

**Paths written as paths** (survive the switch-over; each rewritten by the move that touches them):
`server/main.ts` (card-host `lib`), `server/cards/cards.test.ts` (card-host `lib`),
`server/pictures/native.ts` (`packages/stage/target/release/stage-shot`), `harness/page/tsconfig.json`
(`packages/canvas/src/**/*.d.ts`), `harness/page/styles/cascade-order.json` (regenerated),
`harness/page/index.html` (a comment), `tools/fixtures/layouts.mjs` (imports
`packages/pen/src/index.ts`), `tools/gates/imports.mjs` (`MOVES_TO` table, Warden's),
`tools/gates/baseline/*.json` (643 keys under these paths), e2e checks that read
`packages/stage` or `packages/canvas` files (10 files, moving to `tools/checks` with Warden),
`packages/stage` internals (20 lines in 15 files: `build-web.sh`, `demo/`), `packages/canvas` (9 lines
in 7 files), root `package.json` `workspaces`, `CONTRIBUTING.md`, `AGENTS.md` (4), docs (53 lines in 8
files).

**Pure renames a script does**: `pen/`, `ui/`, `engine/` (all of it), and step 4a (`packages/canvas`
→ `canvas/` with `src/` flattened, nothing regrouped). **Not pure**: folding in ink, card-host and
docs' page half (exports change), the folder reorganisation inside `canvas/` (relative imports
recomputed), and every split.

### The script: `docs/rewrite/loom/move.mjs` (in Loom's lane), written in phase 2

1. Reads a table `docs/rewrite/loom/moves/<step>.json`: `[{ from, to }]` (a file or a folder),
   `specifiers: { "@decks/stage": "@decks/engine" }`, `paths: [{ file, from, to }]`, and the new
   `exports` of each touched `package.json`.
2. `--dry` prints every `git mv`, every changed line, and the counts; nothing is written.
3. Without `--dry`: `git mv` each entry (so history follows); for every tracked source file, every
   relative specifier is resolved against the file's old place to an old target, mapped through the
   table to its new place, and written back relative to the file's new place. Bare specifiers by the
   table. Path strings by the `paths` list, each checked to have matched exactly once.
4. Re-keys the gate baselines: a key under an old path becomes the same key under the new path,
   with the same count (needs Warden's say, section 5).
5. Ends by printing the commands to run: `node tools/check.mjs <folder>`, `node tools/gates/run.mjs`,
   and the browser checks for the step. It runs none of them itself (heavy ones go through the lock).
6. Its tests: a tiny fixture tree in `docs/rewrite/loom/moves/fixture/`, moved in memory.

## 4. The order

Each step is its own commits; after each, the folder's check and the gates pass, and that step's
browser checks run through `node tools/checks/run.mjs <check>` under the lock, one run at a time.

| step | does | then runs |
|---|---|---|
| **0. Before** | lanes for `pen/ ui/ engine/ canvas/` and the old package folders granted; the three rule-3 breaks of section 1 resolved (section 5, row 1) | `node tools/check.mjs harness`, gates |
| **1. pen/** | pure rename; `workspaces` gets `pen`; `tools/fixtures/layouts.mjs` path; README | `check pen`, `check server`, gates; browser: the drawing and export checks (`stage-goldens`, `stage-shot`, `placeholder`) |
| **2. ui/** | pure rename; README | `check ui`, `check harness`, gates; browser: `chrome`, `agent-rows`, `walkthrough` |
| **3. engine/** | rename to `engine/`, `@decks/stage` → `@decks/engine` (13 + 3); `pkg/`, `pkg-gl/` out of git and built; `server/pictures/native.ts` path; README; Anvil told first | `check server`, gates, `cargo test` (heavy); browser: `backends`, `tile-pixels`, `stage-goldens`, `layers-webkit` |
| **4a. canvas/** | `packages/canvas` → `canvas/`, `src/` flattened, nothing regrouped; `exports`, `harness/page/tsconfig.json`, cascade order regenerated | `check canvas`, `check harness`, gates, `node server/frame/build.mjs` (heavy); browser: all 76 once (the frame page is rebuilt from it) |
| **4b. ink** | `packages/ink` into `canvas/ink/`; `@decks/ink` gone | `check canvas`; browser: `ink-long-stroke`, ink checks |
| **4c. card runtime** | `packages/card-host` into `canvas/cards/runtime/`; `server/main.ts`, `server/cards/cards.test.ts` paths; `lib/` built | `check canvas`, `check server`; browser: card checks (`card-tab`, `card-links`, `card-keys`, `card-copy`) |
| **4d. documents** | docs' page half into `canvas/documents/` | `check canvas`; browser: document checks |
| **4e. regroup** | `canvas/` into the folders of section 1, one folder per commit, by the script | `check canvas`, `check harness`, gates per commit; browser: all 76 once at the end |
| **5. splits** | one file per commit, smallest risk first: pen, ui, ink, then canvas pure-logic (`gesture`, `overlay`, `drawing`, `controller`), then page parts, then `render/engine.ts`, then documents, then `canvas.css`, then Rust | `check <folder>` and gates per commit; the browser checks that touch the part after each; all 76 after each folder |
| **6. zero baselines** | the remaining names, comments and state exceptions of these folders (section 5, last rows) | gates |
| **7. done** | `packages/` gone; READMEs; all 76 browser checks, twice | |

## 5. What breaks if moved

| what | why it breaks | what the move does |
|---|---|---|
| **canvas imports three packages the switch-over deletes** | `@decks/protocol` (old: `Page`, `Presence`, `PresenceBy`, `LineClientMessage`, `StageCall`, `ChangeAuthor`; `Camera` as a type), `@decks/api` (`cardCalls`), `@decks/hub/follower` | **Must be settled before the switch-over deletes them**, or Warden keeps those three packages under "kept until Loom moves them". Recommended: Lexicon adds the missing shapes to `protocol/` (or says which new names mean them) and a `callsFor("card")` helper; the follower moves into `canvas/host/inside/follower.ts` on `protocol/sync.ts`. Then 37 files rewrite their `import type` lines. |
| the build: root `package.json` | `workspaces` lists `packages/*`; scripts name `@decks/web`, `@decks/server` | Warden's switch-over rewrites scripts; each Loom step adds its folder to `workspaces`; the last removes `packages/*` |
| the build: `scripts/build-solid-lib.mjs`, `build-packages.mjs` | build `packages/canvas` into `dist/lib` for hosts | they move to `tools/` with Warden; their argument becomes `canvas` |
| `server/frame/` (Warden's) | `build.mjs` builds `canvas-frame.html` from `harness/page`'s vite config, which resolves `@decks/canvas` by name: unaffected; `dist/` must be rebuilt after each canvas step | rebuild under the lock after 4a, 4e and the splits |
| `server/main.ts`, `server/cards/cards.test.ts` | read `../packages/card-host/lib` by path | point at the built `canvas/cards/runtime/lib` through an export, not a path (step 4c) |
| `server/pictures/native.ts` | runs `packages/stage/target/release/stage-shot` | `engine/target/release/stage-shot` (step 3) |
| the harness page | `tsconfig.json` includes `../../packages/canvas/src/**/*.d.ts`; `cascade-order.json` keys sheets by path; `index.css` imports `@decks/canvas/styles/*.css` by name (unaffected); `PenTray.tsx` imports `@decks/ink` | 4a rewrites the include, regenerates the order; 4b rewrites PenTray. `harness/page/` is Pane's lane: Pane is told, or Mason grants the two files |
| **Studio** (`decks-studio`) | `package.json` and `page/package.json` say `file:../decks-dev/packages/{canvas,pen,stage,ui}` (5); `page/tsconfig.json`; 41 imports by name (unaffected but `@decks/stage`); pinned in `DECKS_COMMIT` | Loft updates the five `file:` paths and `@decks/stage` → `@decks/engine` when it re-pins past step 3 and 4a. Nothing breaks until Studio re-pins |
| **the iPad repo** (`decks-ios`) | `scripts/build-engine.sh` (`$decks/packages/stage`), `scripts/fetch-fonts.sh`, `Tests/DecksEngineTests/DrawTests.swift` (4 paths), `Package.swift` (comment) | Slate changes `packages/stage` → `engine` in those 4 files when it next builds past step 3 |
| **Anvil** | works in `packages/stage/crates/apple`, `Cargo.toml`, `Cargo.lock` now | step 3 waits for Anvil to be between commits; its lane moves to `engine/crates/apple` with it |
| **Pane** | owns `packages/canvas/src/ui/` in `lanes.json` today | the canvas chrome becomes `canvas/chrome/`, Loom's from step 4a; Pane told first |
| e2e / browser checks | 10 checks read engine or canvas files by path (`backends-kit.mjs` copies `render/backends/notice.ts` word for word); 469 selectors use `.stage*` classes | the paths are rewritten where Warden moved the checks; **class names do not change** |
| **built files in git** (rule 10) | `packages/stage/pkg/*`, `pkg-gl/*` (8, the wasm the canvas imports); `packages/card-host/lib/*` (112 tracked, 8 baselined today: d3, three katex files, four wasm; the gate does not yet see the others: `marked.umd.js`, `pdf*.mjs`, the bundles *hljs.bundle.mjs*, *mermaid.bundle.mjs*, `live-doc.js` (built by `scripts/live-doc.mjs`), pdf.js fonts and type files) | `engine/pkg*` built by `npm run build -w @decks/engine` (cargo and wasm-pack, heavy) and ignored; the vendored libraries in `lib/` copied from their npm packages at install by `canvas/cards/runtime/lib.mjs`, ignored; the bundles and `live-doc.js` built by a script under the lock; the runtime's own hand-written files (`card.js`, `card.css`, `theme.css`, `live-app.js`, `live-web.js`) are source and move to `canvas/cards/runtime/`, out of `lib/`. New npm dependencies (d3, katex, pdfjs-dist) need Mason's yes. |
| **names gate** | 2,953 baselined uses of `board` (1,860) and `stage` (1,093) in these packages, many in DOM class names (`.stage`, `.stage-fixed`, `.stage-ink`, 8 classes in 94 CSS lines) that the browser checks, Studio and cards select by | identifiers, file names and comments renamed in step 6; the eight class names stay, so the gate needs a rule for them (below) |
| comments gate | 822 baselined: 556 comments over 5 lines, 266 em dashes | step 6: each long comment cut to its rule; the story to `docs/decisions/` only where it holds a reason not in the code |
| state gate | 50 baselined top-level `let`s (canvas 33, stage's JS 13, ui 4) | step 6: each into a store owned by its part |
| imports gate | 1 baselined (canvas → hub) | gone with row 1 |
| gate baselines keyed by path | 643 keys name these packages' paths; a moved file with an exception would read as new and fail | the script re-keys them (Warden owns `tools/gates/baseline/`; asked in the done line) |

## 6. Decisions (going ahead on the recommended option)

1. **Package names stay** (`@decks/canvas`, `@decks/pen`, `@decks/ui`), `@decks/stage` →
   `@decks/engine`. Alternative: `@decks/canvas` etc. renamed to match folders already. Same thing.
2. **No `src/` level** in the new folders, like `server/` and `harness/`.
3. **The canvas's eight `stage` class names stay**, as the brief says markup and class names stay.
   Recommended: Warden's names gate gets a short rule, "the markup names in
   `canvas/styles/markup-names.json` keep their word", the way the engine's crates keep `stage`; an
   exception by rule, not by baseline. Alternative: rename them and the 469 selectors in the checks,
   Studio's and cards' CSS (a change of behaviour for cards; not recommended).
4. **Built files leave git** (`engine/pkg*`, `cards/runtime/lib` vendored files), built at install or
   build. Alternative: keep them and a baselined exception (fails "done when").
5. **The three rule-3 breaks are settled before the switch-over** by Lexicon (shapes, card calls) and
   Loom (the follower into `canvas/host/`), else Warden keeps `packages/protocol`, `api`, `hub` until
   step 4a.

## 7. Lanes Loom needs for phase 2

`pen/`, `ui/`, `engine/` (except `crates/apple/`, Anvil's), `canvas/`, and to delete: `packages/pen`,
`packages/ui`, `packages/stage` (except Anvil's paths, moved with Anvil), `packages/canvas` (with
Pane's `src/ui/`), `packages/card-host`, `packages/ink`, `packages/docs`. One-line edits in others'
files, by their owner or with Mason's grant: `server/main.ts`, `server/cards/cards.test.ts`,
`server/pictures/native.ts`, `harness/page/tsconfig.json`, `harness/page/styles/cascade-order.json`,
`harness/page/frame/PenTray.tsx`, `tools/fixtures/layouts.mjs`, `tools/gates/imports.mjs`,
`tools/gates/baseline/*.json`, root `package.json`.

## 8. Counts at a glance

| | |
|---|---|
| source files moving | pen 26, ui 15, engine 100 crate files + 20 others, canvas 185, card-host 4 + 112 lib, ink 2, docs page half 20 |
| files over 400 lines | 30 TS/TSX/CSS + 11 Rust |
| functions over 80 lines | 78 |
| imports by name rewritten | 24 (13 stage, 5 ink, 4 card-host, 2 docs) |
| relative imports recomputed | about 350 of 536 |
| gate baseline keys re-keyed | 643 |

## 9. The measurements

Long functions, by the size gate's own parser (`longFunctions` in `tools/gates/size.mjs`), server half
of docs excluded:

| file (under packages/) | functions over 80 lines |
|---|---|
| `canvas/src/camera/controller.ts` | `createCameraController` 450 |
| `canvas/src/camera/insets.ts` | `watchInsets` 163 |
| `canvas/src/camera/stage-ops.ts` | `runStageCall` 104 |
| `canvas/src/cards/CardEditor.tsx` | `CardEditor` 1384, `inline` 101, `block` 82, `(anonymous)` 122 |
| `canvas/src/edit/core/gesture.ts` | `step` 82 |
| `canvas/src/edit/core/overlay-json.ts` | `overlayJson` 87 |
| `canvas/src/edit/dom/OverlayLayer.tsx` | `OverlayLayer` 396 |
| `canvas/src/edit/dom/TextEditing.tsx` | `createTextEditing` 312, `TextEditor` 116, `(anonymous)` 110 |
| `canvas/src/edit/dom/controller.ts` | `createEditor` 247 |
| `canvas/src/edit/dom/effects.ts` | `createEffects` 173 |
| `canvas/src/edit/dom/pointer.ts` | `createPointer` 766, `touchOnDrawing` 120 |
| `canvas/src/editor.tsx` | `createEditor` 310 |
| `canvas/src/frame/inside/backend.ts` | `createBackend` 90 |
| `canvas/src/frame/inside/boot.ts` | `openFrame` 221 |
| `canvas/src/frame/inside/clipboard.ts` | `installClipboard` 96 |
| `canvas/src/frame/inside/events.ts` | `wireFrame` 275 |
| `canvas/src/frame/inside/frame.tsx` | `run` 139, `(anonymous)` 136 |
| `canvas/src/frame/inside/line.ts` | `openLine` 85 |
| `canvas/src/frame/inside/options.ts` | `installHost` 123, `editorOptions` 131 |
| `canvas/src/frame/inside/presence.ts` | `installPresence` 127 |
| `canvas/src/frame/inside/studio-line.ts` | `createStudioLine` 87 |
| `canvas/src/frame/outside/host.tsx` | `createFramedEditor` 494, `wire` 83, `keepInStep` 108 |
| `canvas/src/ink/StageInk.tsx` | `StageInk` 668 |
| `canvas/src/items/MediaPlayer.tsx` | `MediaPlayer` 243 |
| `canvas/src/items/card-surface.tsx` | `CardSurface` 229 |
| `canvas/src/items/card.ts` | `mountCard` 152 |
| `canvas/src/items/item-slot.tsx` | `ItemSlot` 201 |
| `canvas/src/items/item-surfaces.tsx` | `AppSurface` 95 |
| `canvas/src/model/drawing.ts` | `createDrawing` 358 |
| `canvas/src/model/markdown.ts` | `blocksOf` 81, `runsOf` 103 |
| `canvas/src/render/engine.ts` | `receive` 87, `fetchPicture` 94 |
| `canvas/src/stage/Stage.tsx` | `Stage` 758 |
| `canvas/src/stage/input.ts` | `createStageInput` 619, `(anonymous)` 214 |
| `canvas/src/stage/items-layer.tsx` | `createItemsLayer` 704 |
| `canvas/src/stage/selection.tsx` | `createSelection` 389, `pills` 135 |
| `canvas/src/ui/AgentCursor.tsx` | `AgentCursor` 83 |
| `canvas/src/ui/Callout.tsx` | `PageCallout` 305 |
| `canvas/src/ui/ColorPicker.tsx` | `ColorPicker` 189 |
| `canvas/src/ui/InkBar.tsx` | `InkBar` 117 |
| `canvas/src/ui/Insert.tsx` | `Insert` 170 |
| `canvas/src/ui/InsertMenu.tsx` | `createInsertMenu` 143 |
| `canvas/src/ui/PenBar.tsx` | `PenBar` 95 |
| `canvas/src/ui/Properties.tsx` | `Properties` 891 |
| `docs/src/page/gview.ts` | `paragraph` 87 |
| `docs/src/page/live.ts` | `inlineMd` 154, `inlineTex` 133, `texLine` 88, `block` 105 |
| `docs/src/page/page.ts` | `mountDocPage` 1270, `buildGoogleTools` 91 |
| `docs/src/page/tex.ts` | `texMeta` 89 |
| `ink/src/ink.ts` | `inkShaper` 112 |
| `pen/src/diff.ts` | `diff` 85, `editDocument` 86 |
| `pen/src/geometry.ts` | `pathBounds` 117 |
| `pen/src/layout.ts` | `layout` 212, `frameContent` 94 |
| `pen/src/ops.ts` | `one` 101 |
| `pen/src/outline.ts` | `mapped` 81 |
| `ui/src/Popover.tsx` | `Popover` 268, `(anonymous)` 99 |
| `ui/src/agent-marks.tsx` | `AgentMark` 118 |
| `ui/src/float/float.ts` | `makeFloat` 462 |
| `ui/src/scribble.tsx` | `ScribbleCatch` 143 |

Scripts used: `.scratch/Loom/{fns,imports,outline,inner}.mjs` (scratch, not committed): long functions,
imports by package and folder, top-level outlines and inner function sizes of each long file.

## 10. Ready for phase 2 (2026-11-14, after Mason's decisions in DESIGN.md section 11)

- **The script**: `move.mjs` (the command), `plan.mjs` (the plan, pure), `apply.mjs` (git mv, carrying
  untracked built files, writing and staging edits; never commits). Tests: `node --test
  docs/rewrite/loom/move.test.mjs`, on the fixture tree in `moves/fixtures/`. A URL is rewritten only
  when made from `import.meta.url`; a card's own address is left alone.
- **The tables**: `moves/1-pen.json`, `2-ui.json`, `3-engine.json`, `4a-canvas.json`, each with its dry
  run (`<step>.dry.md`) and the old-to-new list for Warden's re-key command (`<step>.renames.json`),
  made on today's tree. At go time each is planned again on the tree as it then is (the switch-over
  moves the checks), dry first, then `--go`.
- **The tables' own fields**: `moves`, `skip` (folders the switch-over deletes, and Warden's and
  Mason's own files), `specifiers` (package names), `mentions` (a folder's old path in strings and
  comments of code), `untrack`, `ignore`, `paths` (a literal that must match a set number of times),
  `set` (top-level JSON values), `workspaces`, `create` (READMEs from `moves/readmes/`), `then`.
- **Step 4a also rewires the old types**, by hand, not by the table: Lexicon's protocol 0.19.0 names
  them (`docs/rewrite/calls.md`, "The canvas library's old types"). `Page` takes a `box` and renamed
  fields, `StageCall` becomes `ViewRequest`, `LineClientMessage` becomes `ClientMessage`,
  `cardCalls(route)` becomes `callsFor("card")`, and the follower moves into the canvas's host. This
  changes code in 37 files, so it is its own commit after the move, with the frame's browser checks.
- **A clash for the switch-over**: `switch-plan.md` keeps `packages/protocol` (named
  `@decks/protocol`) and also renames `@decks-next/protocol` to `@decks/protocol`. Two workspaces
  cannot share a name; the kept one needs another name until step 4a (Warden's call).
