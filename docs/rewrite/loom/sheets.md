# Step 5: the split sheets

Made by `node docs/rewrite/loom/sheets.mjs` from the specs in `splits/`, measured on today's files.
Each sheet says the files a long file becomes, which top-level part (function, type, constant, or a
class's or closure's member) goes to each, the lines that results (imports a file needs counted in), and
where each function still over 80 lines is cut. Line numbers are today's. A part that leaves a closure
takes the closure's shared state as one `ctx` argument; a class's method that leaves becomes a function
given the instance. Behaviour, markup and class names stay.

73 sheets; new files over 400 lines: 0.

| file after the move | lines today | new files | largest | functions still over 80 (cut below) |
|---|---|---|---|---|
| [*canvas/camera/controller.ts*](#canvas-camera-controller) | 490 | 4 | 229 | 0 |
| [*canvas/camera/insets.ts*](#canvas-camera-insets) | 284 | 1 | 287 | 1 |
| [*canvas/camera/view-calls.ts*](#canvas-camera-view-calls) | 210 | 1 | 209 | 1 |
| [*canvas/cards/CardEditor.tsx*](#canvas-cards-CardEditor) | 1470 | 8 | 294 | 3 |
| [*canvas/cards/card-surface.tsx*](#canvas-cards-card-surface) | 260 | 1 | 260 | 1 |
| [*canvas/cards/card.ts*](#canvas-cards-card) | 760 | 5 | 230 | 1 |
| [*canvas/cards/markdown.ts*](#canvas-cards-markdown) | 366 | 1 | 369 | 2 |
| [*canvas/chrome/AgentCursor.tsx*](#canvas-chrome-AgentCursor) | 120 | 1 | 122 | 1 |
| [*canvas/chrome/Callout.tsx*](#canvas-chrome-Callout) | 345 | 1 | 345 | 1 |
| [*canvas/chrome/ColorPicker.tsx*](#canvas-chrome-ColorPicker) | 249 | 1 | 249 | 1 |
| [*canvas/chrome/InkBar.tsx*](#canvas-chrome-InkBar) | 154 | 1 | 154 | 1 |
| [*canvas/chrome/Insert.tsx*](#canvas-chrome-Insert) | 212 | 1 | 212 | 1 |
| [*canvas/chrome/InsertMenu.tsx*](#canvas-chrome-InsertMenu) | 195 | 1 | 196 | 1 |
| [*canvas/chrome/PenBar.tsx*](#canvas-chrome-PenBar) | 139 | 1 | 139 | 1 |
| [*canvas/chrome/Properties.tsx*](#canvas-chrome-Properties) | 1249 | 9 | 270 | 0 |
| [*canvas/documents/gview.ts*](#canvas-documents-gview) | 2091 | 8 | 367 | 1 |
| [*canvas/documents/live.ts*](#canvas-documents-live-builder) | 2053 | 6 | 315 | 4 |
| [*canvas/documents/live.ts*](#canvas-documents-live-editor) | 2053 | 8 | 351 | 4 |
| [*canvas/documents/page.ts*](#canvas-documents-page) | 1751 | 9 | 352 | 1 |
| [*canvas/documents/tex.ts*](#canvas-documents-tex) | 247 | 1 | 248 | 1 |
| [*canvas/drawing/drawing.ts*](#canvas-drawing-drawing) | 576 | 5 | 187 | 0 |
| [*canvas/editor/core/gesture.ts*](#canvas-editor-core-gesture) | 694 | 4 | 242 | 1 |
| [*canvas/editor/core/overlay-json.ts*](#canvas-editor-core-overlay-json) | 119 | 1 | 123 | 1 |
| [*canvas/editor/core/overlay.ts*](#canvas-editor-core-overlay) | 547 | 4 | 257 | 0 |
| [*canvas/editor/dom/OverlayLayer.tsx*](#canvas-editor-dom-OverlayLayer) | 431 | 3 | 192 | 0, shell 371 |
| [*canvas/editor/dom/TextEditing.tsx*](#canvas-editor-dom-TextEditing) | 483 | 3 | 287 | 2 |
| [*canvas/editor/dom/controller.ts*](#canvas-editor-dom-controller) | 305 | 1 | 306 | 1 |
| [*canvas/editor/dom/effects.ts*](#canvas-editor-dom-effects) | 219 | 1 | 219 | 1 |
| [*canvas/editor/editor.tsx*](#canvas-editor-editor) | 352 | 1 | 351 | 1 |
| [*canvas/host/inside/backend.ts*](#canvas-host-inside-backend) | 196 | 1 | 196 | 1 |
| [*canvas/host/inside/boot.ts*](#canvas-host-inside-boot) | 279 | 1 | 279 | 1 |
| [*canvas/host/inside/clipboard.ts*](#canvas-host-inside-clipboard) | 189 | 1 | 189 | 1 |
| [*canvas/host/inside/events.ts*](#canvas-host-inside-events) | 299 | 1 | 299 | 1 |
| [*canvas/host/inside/frame.tsx*](#canvas-host-inside-frame) | 207 | 1 | 207 | 2 |
| [*canvas/host/inside/line.ts*](#canvas-host-inside-line) | 125 | 1 | 125 | 1 |
| [*canvas/host/inside/options.ts*](#canvas-host-inside-options) | 309 | 1 | 309 | 2 |
| [*canvas/host/inside/presence.ts*](#canvas-host-inside-presence) | 163 | 1 | 168 | 1 |
| [*canvas/host/inside/studio-line.ts*](#canvas-host-inside-studio-line) | 115 | 1 | 115 | 1 |
| [*canvas/host/outside/framed-editor.tsx*](#canvas-host-outside-framed-editor) | 660 | 6 | 215 | 2 |
| [*canvas/ink/InkLayer.tsx*](#canvas-ink-InkLayer) | 704 | 5 | 267 | 0 |
| [*canvas/ink/shaper.ts*](#canvas-ink-shaper) | 421 | 3 | 183 | 1 |
| [*canvas/input/canvas-input.ts*](#canvas-input-canvas-input) | 687 | 4 | 318 | 1 |
| [*canvas/input/pointer.ts*](#canvas-input-pointer) | 900 | 6 | 269 | 1 |
| [*canvas/items/MediaPlayer.tsx*](#canvas-items-MediaPlayer) | 288 | 1 | 289 | 1 |
| [*canvas/items/item-slot.tsx*](#canvas-items-item-slot) | 289 | 1 | 290 | 1 |
| [*canvas/items/item-surfaces.tsx*](#canvas-items-item-surfaces) | 248 | 1 | 251 | 1 |
| [*canvas/render/engine.ts*](#canvas-render-engine) | 2481 | 12 | 343 | 2 |
| [*canvas/styles/canvas.css*](#canvas-styles-canvas) | 1700 | 8 | 346 | 0 |
| [*canvas/view/CanvasView.tsx*](#canvas-view-CanvasView) | 938 | 6 | 305 | 0 |
| [*canvas/view/items-layer.tsx*](#canvas-view-items-layer) | 754 | 4 | 282 | 0 |
| [*canvas/view/selection.tsx*](#canvas-view-selection) | 452 | 4 | 170 | 1 |
| [*engine/crates/doc/src/lib.rs*](#engine-doc-lib) | 600 | 5 | 215 | 0 |
| [*engine/crates/gpu/src/lib.rs*](#engine-gpu-lib) | 402 | 3 | 195 | 0 |
| [*engine/crates/gpu/src/tests.rs*](#engine-gpu-tests) | 651 | 5 | 192 | 0 |
| [*engine/crates/paint/src/painter.rs*](#engine-paint-painter) | 1174 | 6 | 276 | 0 |
| [*engine/crates/scene/src/layout.rs*](#engine-scene-layout) | 433 | 2 | 215 | 0 |
| [*engine/crates/scene/src/lib.rs*](#engine-scene-lib) | 517 | 5 | 204 | 0 |
| [*engine/crates/shot/src/lib.rs*](#engine-shot-lib) | 579 | 4 | 225 | 0 |
| [*engine/crates/text/src/card.rs*](#engine-text-card) | 545 | 4 | 219 | 0 |
| [*engine/crates/text/src/lib.rs*](#engine-text-lib) | 432 | 2 | 326 | 0 |
| [*engine/crates/web/src/bind.rs*](#engine-web-bind) | 1137 | 6 | 249 | 0 |
| [*engine/crates/web/src/engine.rs*](#engine-web-engine) | 2485 | 7 | 370 | 0 |
| [*pen/diff.ts*](#pen-diff) | 301 | 1 | 301 | 2 |
| [*pen/geometry.ts*](#pen-geometry) | 266 | 1 | 266 | 1 |
| [*pen/html.ts*](#pen-html) | 705 | 5 | 300 | 0 |
| [*pen/layout.ts*](#pen-layout) | 419 | 3 | 292 | 2 |
| [*pen/ops.ts*](#pen-ops) | 356 | 1 | 355 | 1 |
| [*pen/outline.ts*](#pen-outline) | 165 | 1 | 167 | 1 |
| [*ui/Popover.tsx*](#ui-Popover) | 306 | 1 | 307 | 2 |
| [*ui/agent-marks.tsx*](#ui-agent-marks) | 312 | 1 | 321 | 1 |
| [*ui/float/float-math.ts*](#ui-float-float-math) | 403 | 3 | 201 | 0 |
| [*ui/float/float.ts*](#ui-float-float) | 586 | 5 | 179 | 0 |
| [*ui/scribble.tsx*](#ui-scribble) | 206 | 1 | 211 | 1 |

<a id="canvas-camera-controller"></a>

## *canvas/camera/controller.ts* (490 lines) → *canvas/camera/controller.ts*

Pattern: model: the controller keeps its signals and returns the same object; writing and motion leave it as functions given a `ctx`.

The 48-line statement at line 336 is a listener set up in the closure; it moves with the motion code as an `installMotion(ctx)` call. The returned controller (24 lines) and the effect at line 376 are built by `controllerApi(ctx)` in *controller-api.ts*.

| new file | lines | what goes there |
|---|---|---|
| controller.ts | 124 | `CameraHost`, `CameraController`, `localCamera`, `lastMoved`, `rafId`, `pendingCamera`, `glideToken`, `glideRaf`, `lastGlideToken`, `[panning, setPanning]`, `[scaling, setScaling]`, `scaleSettle`, `[moving, setMoving]`, `moveSettle`, `[gliding, setGliding]`, `written`, `ExpressionStatement@139`, `ExpressionStatement@145` |
| controller-write.ts | 138 | `writeTransform`, `nowMoving`, `nowScaling`, `stopped`, `write`, `placeNow`, `push`, `settled`, `rest` |
| controller-motion.ts | 229 | `glidePending`, `coastRaf`, `cancelCoast`, `coast`, `cancelGlide`, `scrolled`, `glideTo`, `ExpressionStatement@336`, `PINCH_TRAVEL`, `WHEEL_TRAVEL`, `wheel`, `zoom` |
| controller-api.ts | 34 | `ExpressionStatement@376`, `ReturnStatement@465` |

The scope `createCameraController` keeps 70 lines of its own; the parts that leave it take its shared state as one `ctx` argument.

No function stays over 80 lines.


<a id="canvas-camera-insets"></a>

## *canvas/camera/insets.ts* (284 lines) → *canvas/camera/insets.ts*

Pattern: functions only: the file stays whole, under 400 lines; each function over 80 lines is cut into named helpers in the same file, at the lines below.

| new file | lines | what goes there |
|---|---|---|
| insets.ts | 287 | `Insets`, `ZERO`, `[insets, setInsets]`, `ExportDeclaration@47`, `canvasBox`, `published`, `narrowTo`, `[insetsMoving, setInsetsMoving]`, `ExportDeclaration@79`, `publishInsets`, `insetsOnly`, `watchInsets`, `useInsets` |

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `watchInsets` (163 lines, in insets.ts): L123 `const measure = () => {`; L201 `const sync = () => {`; L262 `onCleanup(() => {`

<a id="canvas-camera-view-calls"></a>

## *canvas/camera/view-calls.ts* (210 lines) → *canvas/camera/view-calls.ts*

Pattern: functions only: the file stays whole, under 400 lines; each function over 80 lines is cut into named helpers in the same file, at the lines below.

| new file | lines | what goes there |
|---|---|---|
| view-calls.ts | 209 | `StageOpsHost`, `defer`, `runStageCall`, `clearLast`, `highlight` |

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `runStageCall` (104 lines, in view-calls.ts): L84 `{`

<a id="canvas-cards-CardEditor"></a>

## *canvas/cards/CardEditor.tsx* (1470 lines) → *canvas/cards/CardEditor.tsx*

Pattern: a page part: model, view and actions in cards/editor/; the CardEditor component keeps its props, its signals and the wiring, and each part takes them as one ctx.

Beside map.md: a block's inline runs (editor/inline.ts), styling a block (editor/style.ts) and presses, keys and drags (editor/actions-press.ts) are files of their own. The mount effect (today's statement at line 1249) goes with the presses it wires. CardEditor.tsx keeps the props, the signals and calls each part.

| new file | lines | what goes there |
|---|---|---|
| CardEditor.tsx | 69 | `CardEditorProps`, `wrap`, `ed`, `bar`, `caret`, `tools`, `line`, `lead`, `trail`, `done`, `frame`, `past`, `future` |
| editor/model.ts | 235 | `ZW`, `h`, `atom`, `fontSpan`, `block`, `build`, `INLINE`, `BLOCKS`, `STYLES`, `Style`, `CUT`, `BLOCK`, `splitAround`, `cut`, `BLOCK_NAMES`, `blockKind` |
| editor/inline.ts | 160 | `url`, `piece`, `inline`, `suggestion`, `list` |
| editor/style.ts | 142 | `insertBlock`, `unwrap`, `restyle`, `style`, `setBlock` |
| editor/markup.ts | 200 | `out`, `outList`, `wrapNode`, `outBlock`, `serialise`, `sel`, `topOf`, `placeAfter` |
| editor/view.tsx | 247 | `BLOCK_MENU`, `SIZE_MENU`, `SIX`, `settleBar`, `SELECTION_PAUSE_MS`, `placeBar`, `showBar`, `toggleMenu`, `closeMenus`, `hideMarks`, `lineSlot`, `textSlot`, `ReturnStatement@1372` |
| editor/actions.ts | 223 | `onInput`, `changed`, `travel`, `onPaste`, `wanted`, `selecting`, `onClick`, `onDblClick`, `caretInto`, `commit`, `onFocusOut`, `appendWords` |
| editor/actions-press.ts | 294 | `dragging`, `ghost`, `press`, `target`, `local`, `onPointerDown`, `onPointerMove`, `endDrag`, `onKeyDown`, `ExpressionStatement@1249` |

The scope `CardEditor` keeps 16 lines of its own; the parts that leave it take its shared state as one `ctx` argument.

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `inline` (101 lines, in editor/inline.ts): L120 `{`
- `block` (82 lines, in editor/model.ts): L251 `switch (t.type) {`; L329 `return atom(raw, raw, "pce-atom pce-raw", "div");`
- `ArrowFunction@1249` (122 lines, in editor/actions-press.ts): L1306 `const press = (event: PointerEvent) => {`; L1335 `requestAnimationFrame(() => {`

<a id="canvas-cards-card-surface"></a>

## *canvas/cards/card-surface.tsx* (260 lines) → *canvas/cards/card-surface.tsx*

Pattern: functions only: the file stays whole, under 400 lines; each function over 80 lines is cut into named helpers in the same file, at the lines below.

| new file | lines | what goes there |
|---|---|---|
| card-surface.tsx | 260 | `shots`, `cardShot`, `CardSurface` |

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `CardSurface` (229 lines, in card-surface.tsx): L86 `const mount = (html: string) => {`; L145 `createEffect(() => {`; L193 `const followLink = (event: MouseEvent) => {`; L245 `const pageOf = (url: URL): string | undefined => {`

<a id="canvas-cards-card"></a>

## *canvas/cards/card.ts* (760 lines) → *canvas/cards/card.ts*

Pattern: logic by topic, top-level parts; card.ts keeps mountCard, the one thing its importers call.

As map.md, with mount.ts kept as card.ts so the `./card` export and its importers stay. card.ts re-exports what `entries/` names from the new files. mountCard (157 lines) is cut where the sheet says: load, run the scripts, wire.

| new file | lines | what goes there |
|---|---|---|
| card.ts | 178 | `mountCard`, `scrollsInside`, `INTERACTIVE` |
| context.ts | 139 | `CardDecks`, `cardDecks`, `CardContext`, `CardCleanup`, `CardSource`, `MountedCard`, `wordsSelectedInCards` |
| sheet.ts | 230 | `RUNS`, `runs`, `DROPPED`, `ADDRESSES`, `inDeck`, `clean`, `cleanCss`, `fromCard`, `cssFromCard`, `addressesFromCard`, `cssInDeck`, `sheets`, `isCardSheet`, `CARD_SHEET`, `HOST_RESET`, `fontsSaid`, `textOf`, `cardSheet`, `asDocument`, `rootStyle`, `dedent` |
| parts.ts | 113 | `cardMath`, `cardCode`, `cardMermaid`, `drawParts` |
| imports.ts | 125 | `loaded`, `once`, `modules`, `importOnce`, `pageScript`, `pageModule`, `deckImportsGiven`, `giveDeckImports`, `deckImports`, `registryPerRoot`, `openRoots` |

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `mountCard` (152 lines, in card.ts): L651 `const store = {`; L708 `return {`

<a id="canvas-cards-markdown"></a>

## *canvas/cards/markdown.ts* (366 lines) → *canvas/cards/markdown.ts*

Pattern: functions only: the file stays whole, under 400 lines; each function over 80 lines is cut into named helpers in the same file, at the lines below.

| new file | lines | what goes there |
|---|---|---|
| markdown.ts | 369 | `Run`, `Alert`, `Align`, `Block`, `ENTITIES`, `decodeEntities`, `EMOJI`, `emojify`, `parseMarkdown`, `footnotesOf`, `blocksOf`, `Style`, `textRuns`, `runsOf`, `sameStyle`, `embedOf`, `wordsOf` |

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `blocksOf` (81 lines, in markdown.ts): L124 `for (const token of tokens) {`; L201 `return out;`
- `runsOf` (103 lines, in markdown.ts): L222 `for (const token of tokens ?? []) {`; L313 `const merged: Run[] = [];`

<a id="canvas-chrome-AgentCursor"></a>

## *canvas/chrome/AgentCursor.tsx* (120 lines) → *canvas/chrome/AgentCursor.tsx*

Pattern: functions only: the file stays whole, under 400 lines; each function over 80 lines is cut into named helpers in the same file, at the lines below.

| new file | lines | what goes there |
|---|---|---|
| AgentCursor.tsx | 122 | `CursorAt`, `DRIFT_MS`, `LEAVE_MS`, `JUMP_PX`, `AgentCursor` |

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `AgentCursor` (83 lines, in AgentCursor.tsx): L92 `return (`

<a id="canvas-chrome-Callout"></a>

## *canvas/chrome/Callout.tsx* (345 lines) → *canvas/chrome/Callout.tsx*

Pattern: functions only: the file stays whole, under 400 lines; each function over 80 lines is cut into named helpers in the same file, at the lines below.

| new file | lines | what goes there |
|---|---|---|
| Callout.tsx | 345 | `GAP`, `PageCallout` |

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `PageCallout` (305 lines, in Callout.tsx): L94 `const choose = (): { below: boolean; sure: boolean } => {`; L150 `createEffect(`; L197 `createEffect(() => {`; L222 `return (`

<a id="canvas-chrome-ColorPicker"></a>

## *canvas/chrome/ColorPicker.tsx* (249 lines) → *canvas/chrome/ColorPicker.tsx*

Pattern: functions only: the file stays whole, under 400 lines; each function over 80 lines is cut into named helpers in the same file, at the lines below.

| new file | lines | what goes there |
|---|---|---|
| ColorPicker.tsx | 249 | `Hsv`, `hexToHsv`, `hsvToHex`, `PALETTE`, `ColorPicker` |

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `ColorPicker` (189 lines, in ColorPicker.tsx): L123 `const dragOver = (event: PointerEvent, el: HTMLElement, move`; L157 `return (`

<a id="canvas-chrome-InkBar"></a>

## *canvas/chrome/InkBar.tsx* (154 lines) → *canvas/chrome/InkBar.tsx*

Pattern: functions only: the file stays whole, under 400 lines; each function over 80 lines is cut into named helpers in the same file, at the lines below.

| new file | lines | what goes there |
|---|---|---|
| InkBar.tsx | 154 | `TOOLS`, `COLOR_NAMES`, `InkBar` |

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `InkBar` (117 lines, in InkBar.tsx): L74 `return (`

<a id="canvas-chrome-Insert"></a>

## *canvas/chrome/Insert.tsx* (212 lines) → *canvas/chrome/Insert.tsx*

Pattern: functions only: the file stays whole, under 400 lines; each function over 80 lines is cut into named helpers in the same file, at the lines below.

| new file | lines | what goes there |
|---|---|---|
| Insert.tsx | 212 | `LUCIDE_START`, `Insert`, `IconCell` |

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `Insert` (170 lines, in Insert.tsx): L94 `onMount(() => {`; L117 `return (`

<a id="canvas-chrome-InsertMenu"></a>

## *canvas/chrome/InsertMenu.tsx* (195 lines) → *canvas/chrome/InsertMenu.tsx*

Pattern: functions only: the file stays whole, under 400 lines; each function over 80 lines is cut into named helpers in the same file, at the lines below.

| new file | lines | what goes there |
|---|---|---|
| InsertMenu.tsx | 196 | `Client`, `InsertHost`, `createInsertMenu`, `InsertMenuApi`, `InsertMenu` |

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `createInsertMenu` (143 lines, in InsertMenu.tsx): L78 `const penCreate = (event: PointerEvent, tool: Exclude<PenToo`; L128 `const penMakeAt = (tool: Exclude<PenTool, "select" | "arrow"`

<a id="canvas-chrome-PenBar"></a>

## *canvas/chrome/PenBar.tsx* (139 lines) → *canvas/chrome/PenBar.tsx*

Pattern: functions only: the file stays whole, under 400 lines; each function over 80 lines is cut into named helpers in the same file, at the lines below.

| new file | lines | what goes there |
|---|---|---|
| PenBar.tsx | 139 | `TOOLS`, `PenBar` |

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `PenBar` (95 lines, in PenBar.tsx): L71 `return (`

<a id="canvas-chrome-Properties"></a>

## *canvas/chrome/Properties.tsx* (1249 lines) → *canvas/chrome/Properties.tsx*

Pattern: a page part: model, view and actions in chrome/properties/; Properties keeps its signals and the panel's place, and returns the view.

The panel's JSX (today's return, lines 517 to 1028) is one statement, so the tool cannot place its parts; it is cut by hand at its sections, each a component given ctx, and `extra` counts the move: view-shape.tsx takes Shape, Layout and Corners (lines 547 to 685), view-paint.tsx Fill, Line and Arrow (686 to 830), view-words.tsx Text and Icon (831 to 954), view-place.tsx Position, Shadow and Arrange (955 to 1027), each plus about 10 lines of imports; view.tsx keeps the panel's frame and header.

| new file | lines | what goes there |
|---|---|---|
| Properties.tsx | 65 | `[shut, setShut]`, `index`, `[narrow, setNarrow]`, `[anchor, setAnchor]`, `PANEL_W`, `place`, `ExpressionStatement@168`, `ExpressionStatement@177`, `ExpressionStatement@179`, `ExpressionStatement@181`, `[keepRatio, setKeepRatio]` |
| properties/model.ts | 270 | `SWATCHES`, `LINES`, `TEXTY`, `FONTS`, `WEIGHTS`, `MIXED`, `Kind`, `kindOf`, `KIND_ICON`, `hexOf`, `colorOf`, `FillMode`, `gradientOf`, `fillModeOf`, `legacyStroke`, `lineWidthOf`, `lineColorOf`, `numberOf`, `shared`, `selected`, `single`, `kinds`, `has`, `fillTargets`, `lineTargets`, `wordTargets`, `effectTargets`, `arrows`, `icons`, `shapes`, `shownOf`, `fillMode`, `fillHex`, `gradientEnd`, `gradientTurn`, `lineColor`, `lineWidth`, `dashOf`, `lineDash`, `closedLines`, `lineAlign`, `words`, `fontFamily`, `fontSize`, `fontWeight`, `italic`, `textAlign`, `textColor`, `lineHeight`, `spacing`, `frames`, `frameFlow`, `framePad`, `frameGap`, `frameAlong`, `frameAcross`, `frameClips`, `frameHugs`, `shapeVertical`, `box`, `arrowSet`, `endName`, `title` |
| properties/actions.ts | 235 | `setTextColor`, `setIconColor`, `edit`, `sent`, `asSent`, `set`, `show`, `writer`, `live`, `setFillMode`, `setFillColor`, `setLineColor`, `setLineWidth`, `setDash`, `setShapeWords`, `setHug`, `setBox`, `order`, `duplicate`, `remove`, `align`, `distribute`, `style`, `setSide`, `joinToMiddle`, `toggle`, `exportNote` |
| properties/fields.tsx | 234 | `Effects`, `held`, `NumField`, `ColorField`, `Swatches`, `IconToggle`, `Section` |
| properties/view.tsx | 71 | `ReturnStatement@517` |
| properties/view-shape.tsx | 151 | (the entry and the shell) |
| properties/view-paint.tsx | 157 | (the entry and the shell) |
| properties/view-words.tsx | 136 | (the entry and the shell) |
| properties/view-place.tsx | 86 | (the entry and the shell) |

The scope `Properties` keeps 45 lines of its own; the parts that leave it take its shared state as one `ctx` argument.

No function stays over 80 lines.


<a id="canvas-documents-gview"></a>

## *canvas/documents/gview.ts* (2091 lines) → *canvas/documents/gview.ts*

Pattern: part in plain DOM: the GoogleView class keeps its state, load and render; geometry, editing, lists, tables and history leave as functions given the view.

map.md's view, paragraph (here *paginate.ts*, with pagination), geometry, edit, history and units, with three changes: the text-unit helpers go to *google/text-units.ts*, since *google/units.ts* already holds the 167 lines of *gdoc/units.ts*; keys and the clipboard leave *edit.ts* for *keys.ts*; lists, tables, links and comments get *lists.ts*. *gview.ts* stays as `export { GoogleView } from "./google/view.ts"`.

| new file | lines | what goes there |
|---|---|---|
| google/view.ts | 275 | `GoogleViewHost`, `loaded`, `ExportDeclaration@2090`, `root`, `page`, `doc`, `units`, `named`, `composing`, `undoStack`, `redoStack`, `replaying`, `commented`, `lastRange`, `pending`, `styling`, `batch`, `afterLoad`, `caretAfterLoad`, `Constructor@210`, `load`, `loaded`, `update`, `applyUnits`, `render` |
| google/paginate.ts | 272 | `effective`, `paginate`, `splitAt`, `markAt`, `paragraph`, `marker`, `object` |
| google/geometry.ts | 175 | `range`, `indexAt`, `select`, `pointAt`, `fixed`, `caretStyle`, `paragraphEnd`, `paragraphStart`, `textRange`, `run`, `paragraphsFrom`, `paragraphsIn` |
| google/edit.ts | 314 | `replace`, `edit`, `textAsItIs`, `paragraphsAsTheyAre`, `restyle`, `transact`, `record`, `join`, `input`, `enter`, `outdent` |
| google/history.ts | 247 | `undo`, `redo`, `step`, `apply`, `state`, `applyLocal`, `inverseOf`, `hints`, `perform` |
| google/lists.ts | 287 | `bullets`, `nest`, `indent`, `bump`, `baseline`, `isNumbered`, `localList`, `setText`, `toggle`, `setParagraph`, `list`, `clearFormatting`, `cellAt`, `table`, `grid`, `fill`, `refill`, `link`, `focus`, `setComments`, `quote`, `plain` |
| google/text-units.ts | 367 | `Unit`, `PT`, `GAP`, `pt`, `DEFAULTS`, `rgb`, `cssColor`, `sameStyle`, `smartQuote`, `runsOf`, `loadFont`, `firstIndex`, `lastIndex`, `WORD`, `wordStart`, `wordEnd`, `lineStart`, `numeral`, `applyText`, `cellStyle`, `buildUnits`, `Step`, `TableStep`, `movePoint`, `shiftStep`, `dedupeBullets` |
| google/keys.ts | 217 | `autoformat`, `autolink`, `paste`, `copy`, `key`, `shortcut`, `tab`, `pageBreak`, `breakPage` |

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `paragraph` (87 lines, in google/paginate.ts): L558 `for (const i of indices) {`

<a id="canvas-documents-live-builder"></a>

## *canvas/documents/live.ts* (2053 lines) → *canvas/documents/live.ts*

Pattern: pure logic, split by topic: the Builder (source text to drawn blocks) leaves *live.ts* for `live/`; this spec is its half.

The Builder's methods split three ways (inline Markdown, TeX, blocks); the LiveEditor class lands whole in *live/editor.ts* here and is split by `canvas-documents-live-editor.json`. *live.ts* stays as a re-export of `LiveEditor`. `inlineMd` (154 lines) and `inlineTex` (133) are cut below. `extra` subtracts the LiveEditor's own split, so *live/editor.ts* reads as that spec leaves it.

| new file | lines | what goes there |
|---|---|---|
| live/builder.ts | 5 | (the entry and the shell) |
| live/builder-inline.ts | 238 | `inline`, `math`, `inlineMd`, `emphasis`, `refText` |
| live/builder-tex.ts | 275 | `TEX_STYLE`, `TEX_REF`, `TEX_HEADING`, `MATH_ENV`, `inlineTex`, `texLine`, `titleBlock`, `envHeading` |
| live/builder-block.ts | 315 | `shiftRange`, `widgets`, `lists`, `envs`, `Constructor@175`, `line`, `lines`, `block`, `float`, `table` |
| live/editor.ts | 99 | `LiveEditor` |
| live/shared.ts | 161 | `LiveHost`, `FormatState`, `InlineStyle`, `BlockStyle`, `Range2`, `UndoEntry`, `PUNCT`, `isSpace`, `isWord`, `h`, `mk`, `inl`, `widget`, `closeBrace`, `linkAt`, `textNodes`, `shown` |

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `inlineMd` (154 lines, in live/builder-inline.ts): L206 `while (i < text.length) {`; L348 `flush(text.length);`
- `inlineTex` (133 lines, in live/builder-tex.ts): L405 `while (i < text.length) {`; L526 `flush(text.length);`
- `texLine` (88 lines, in live/builder-tex.ts): L677 `if (textEnv && TEXT_ENVS.has(textEnv[2]!)) {`
- `block` (105 lines, in live/builder-block.ts): L787 `if (kind === "preamble" || (!this.tex && first && /^---\s*$/`; L856 `for (const line of tail) {`

<a id="canvas-documents-live-editor"></a>

## *canvas/documents/live.ts* (2053 lines) → *canvas/documents/live.ts*

Pattern: part: the LiveEditor class keeps its state and its rendering; input, blocks and history leave as functions given the editor.

map.md's editor, editor-input, editor-blocks and editor-view, plus *editor-history.ts* for apply, undo and redo. The Builder and the shared helpers land as in `canvas-documents-live-builder.json` (their sizes are measured there). `extra` stands in for the Builder's own split, so *live/builder.ts* and *live/builder-tex.ts* read as that spec leaves them.

| new file | lines | what goes there |
|---|---|---|
| live/editor.ts | 99 | `shiftRange`, `root`, `tex`, `drawnText`, `keys`, `end`, `composing`, `deferred`, `opened`, `undoStack`, `redoStack`, `applying`, `mathCache`, `onSelection`, `Constructor@988`, `destroy`, `reset`, `redraw` |
| live/editor-view.ts | 351 | `render`, `drawWidgets`, `highlight`, `chunks`, `offsetAt`, `selection`, `pointAt`, `place`, `reveal`, `scrollToCaret`, `readBack` |
| live/editor-input.ts | 288 | `beforeInput`, `targetRange`, `lineAround`, `chunkKind`, `prefixOf`, `enter`, `backspaceAtLineStart`, `keydown`, `hiddenSourceAt`, `copy`, `paste`, `drop`, `pressed`, `clicked` |
| live/editor-blocks.ts | 229 | `delimiters`, `CLASS`, `around`, `toggle`, `link`, `setBlock`, `inTexList`, `codeBlock`, `insertBlock` |
| live/editor-history.ts | 161 | `remote`, `selectionMoved`, `state`, `apply`, `local`, `goto`, `replace`, `undo`, `redo`, `applicable`, `moveHistory` |
| live/builder.ts | 5 | `Builder` |
| live/shared.ts | 161 | `LiveHost`, `FormatState`, `InlineStyle`, `BlockStyle`, `Range2`, `UndoEntry`, `PUNCT`, `isSpace`, `isWord`, `h`, `mk`, `inl`, `widget`, `closeBrace`, `linkAt`, `textNodes`, `shown` |
| live/builder-tex.ts | 260 | `TEX_STYLE`, `TEX_REF`, `TEX_HEADING`, `MATH_ENV` |

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `inlineMd` (154 lines, in live/builder.ts): L206 `while (i < text.length) {`; L348 `flush(text.length);`
- `inlineTex` (133 lines, in live/builder.ts): L405 `while (i < text.length) {`; L526 `flush(text.length);`
- `texLine` (88 lines, in live/builder.ts): L677 `if (textEnv && TEXT_ENVS.has(textEnv[2]!)) {`
- `block` (105 lines, in live/builder.ts): L787 `if (kind === "preamble" || (!this.tex && first && /^---\s*$/`; L856 `for (const line of tail) {`

<a id="canvas-documents-page"></a>

## *canvas/documents/page.ts* (1751 lines) → *canvas/documents/page.ts*

Pattern: part in plain DOM: model (the page's state), view (what it draws), actions (versions, PDF, git, Google), plus the toolbars, the elements it builds, and its sheet.

map.md's model, view, tools, actions, page.css and icons, plus *dom.ts* (the elements `mountDocPage` builds, returned as one object), *text.ts* (the caret and the text's own updates) and *wire.ts* (the listeners it installs and the handle it returns). *page.css* is the 348-line `STYLE` string as a sheet, scoped to `.doc-page`; *page.ts* stays as `export { mountDocPage } from "./page/model.ts"`.

| new file | lines | what goes there |
|---|---|---|
| page/model.ts | 141 | `DocPageOptions`, `DocPage`, `GComment`, `base`, `dir`, `mac`, `keyName`, `when`, `clip`, `marks`, `composing`, `view`, `comments`, `commentsError`, `versions`, `viewing`, `picked`, `mode`, `urls`, `pictures`, `near`, `recent`, `isGoogle`, `isWord`, `isTex`, `initial`, `pdfOpen`, `pdfTimer`, `pdfBusy`, `pdfAgain`, `pdfPath`, `pdfBytes`, `pdfDrawn`, `savedWidth`, `repo`, `gitBusy`, `gitSaid`, `remoteStatus`, `pasteSaid` |
| page/page.css | 352 | `STYLE` |
| page/icons.ts | 58 | `ICON`, `svg` |
| page/dom.ts | 147 | `el`, `IfStatement@482`, `ExpressionStatement@483`, `ExpressionStatement@484`, `bar`, `name`, `status`, `spacer`, `iconButton`, `labelled`, `sourceButton`, `historyButton`, `pdfButton`, `ExpressionStatement@502`, `changesButton`, `commentsButton`, `gitBox`, `gitButton`, `gitMenu`, `ExpressionStatement@509`, `googleBox`, `googleButton`, `googleMenu`, `ExpressionStatement@514`, `ExpressionStatement@515`, `tools`, `main`, `scroll`, `text`, `panel`, `banner`, `old`, `pill`, `ExpressionStatement@524`, `divider`, `pdfPane`, `pdfBar`, `pdfState`, `errButton`, `errList`, `pdfBody`, `ExpressionStatement@532`, `ExpressionStatement@533`, `ExpressionStatement@534`, `buttons`, `styleBox`, `styleButton`, `styleMenu`, `ExpressionStatement@654`, `ExpressionStatement@666`, `ExpressionStatement@667`, `ExpressionStatement@684` |
| page/tools.ts | 272 | `styleQueue`, `HOLD_MS`, `pumping`, `sendStyle`, `pump`, `styles`, `styleNow`, `styleLabel`, `closeMenu`, `buildTools`, `FONTS`, `gcontrols`, `buildGoogleTools`, `askLink`, `gpressed`, `pressed`, `setMode` |
| page/view.ts | 298 | `show`, `whoOf`, `header`, `changesDrawn`, `changesKey`, `drawChanges`, `drawCommentsButton`, `sendComment`, `drafting`, `newComment`, `drawComments`, `hotComment`, `ExpressionStatement@1218`, `hot`, `pillFor`, `pillTimer`, `showPill`, `hidePill`, `ForOfStatement@1267`, `ExpressionStatement@1275`, `ExpressionStatement@1276`, `ExpressionStatement@1277`, `drawHistory`, `drawPages` |
| page/text.ts | 224 | `sync`, `live`, `reading`, `gview`, `ExpressionStatement@607`, `ExpressionStatement@608`, `ExpressionStatement@609`, `texts`, `offsetOf`, `caret`, `place`, `draw`, `shiftCaret`, `ExpressionStatement@962`, `ExpressionStatement@963`, `ExpressionStatement@967`, `typed`, `updated`, `refresh` |
| page/actions.ts | 349 | `restoreTo`, `openVersion`, `closeVersion`, `recompile`, `openPdf`, `closePdf`, `compileNow`, `compileSoon`, `showPdf`, `drawPdf`, `lineOffset`, `showErrors`, `compiled`, `drawGit`, `runGit`, `repoAnswered`, `closeGit`, `ExpressionStatement@1574`, `ExpressionStatement@1583`, `signInParts`, `drawGoogle`, `stop`, `ticker` |
| page/wire.ts | 84 | `ExpressionStatement@1387`, `ExpressionStatement@1388`, `IfStatement@1391`, `ExpressionStatement@1647`, `ExpressionStatement@1653`, `ExpressionStatement@1660`, `ExpressionStatement@1661`, `ExpressionStatement@1662`, `ExpressionStatement@1663`, `ExpressionStatement@1667`, `ExpressionStatement@1670`, `ExpressionStatement@1689`, `ExpressionStatement@1690`, `ExpressionStatement@1691`, `ExpressionStatement@1692`, `ExpressionStatement@1736`, `ReturnStatement@1738` |

The scope `mountDocPage` keeps 41 lines of its own; the parts that leave it take its shared state as one `ctx` argument.

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `buildGoogleTools` (91 lines, in page/tools.ts): L808 `colour("colour", "Text colour", "foregroundColor");`

<a id="canvas-documents-tex"></a>

## *canvas/documents/tex.ts* (247 lines) → *canvas/documents/tex.ts*

Pattern: functions only: the file stays whole, under 400 lines; each function over 80 lines is cut into named helpers in the same file, at the lines below.

| new file | lines | what goes there |
|---|---|---|
| tex.ts | 248 | `LabelKind`, `TexMeta`, `THEOREMS`, `TEXT_ENVS`, `closeBraceAt`, `blankComments`, `arg`, `texMeta`, `TabularCell`, `readTabular`, `readMacros`, `withMacros` |

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `texMeta` (89 lines, in tex.ts): L100 `for (let m = token.exec(text); m; m = token.exec(text)) {`; L157 `if (bib.size) {`

<a id="canvas-drawing-drawing"></a>

## *canvas/drawing/drawing.ts* (576 lines) → *canvas/drawing/drawing.ts*

Pattern: model: `createDrawing` keeps its signals and returns the same object; its long steps become functions given a `ctx` of that state.

*drawing.ts* keeps `Drawing`, `DrawingOptions` and `createDrawing`: its signals, the pending queue and the returned object. The returned object (54 lines) is built by `drawingApi(ctx)` in *api.ts*, so the closure keeps only its state and that one call.

| new file | lines | what goes there |
|---|---|---|
| drawing.ts | 143 | `Drawing`, `DrawingOptions`, `PENDING_MS`, `look`, `depth`, `first`, `[doc, setDoc]`, `undoStack`, `redoStack`, `measure`, `ownDoc`, `host`, `[given, setGiven]`, `[waiting, setWaiting]`, `scope`, `pending`, `inFlight`, `inFlightTimer`, `stepsAfter`, `history`, `sent`, `tab`, `named`, `wait`, `pageId` |
| pages.ts | 170 | `PAGE_TAGS`, `itemKind`, `isPage`, `isCardItem`, `pagePath`, `num`, `cardFrame`, `pagesOf`, `pagesAhead`, `together`, `itemFields`, `itemTitle`, `onTop` |
| edits.ts | 187 | `applied`, `made`, `show`, `showOver`, `commit`, `Pending`, `Change`, `drop`, `flush`, `edit`, `step` |
| receive.ts | 73 | `nameOne`, `forgetHistory`, `receive` |
| api.ts | 59 | `ReturnStatement@503` |

The scope `createDrawing` keeps 37 lines of its own; the parts that leave it take its shared state as one `ctx` argument.

No function stays over 80 lines.


<a id="canvas-editor-core-gesture"></a>

## *canvas/editor/core/gesture.ts* (694 lines) → *canvas/editor/core/gesture.ts*

Pattern: pure logic, split by topic: the gesture's types and `step` stay; each kind of press moves to a file of its own.

*gesture.ts* keeps the types, the constants, `initialState` and `step`, which dispatches to the three files; the entry re-exports as before.

| new file | lines | what goes there |
|---|---|---|
| gesture.ts | 242 | `SETTLE_MS`, `RADIUS_HOLD_MS`, `PAGE_HOLD_MS`, `HANDLE_TAP_MS`, `PointerInput`, `Tap`, `Carry`, `Gesture`, `Input`, `Effect`, `GestureContext`, `Step`, `ZERO`, `initialState`, `step`, `shownDrag` |
| gesture-carry.ts | 214 | `isFree`, `done`, `carry`, `moveCarry`, `releaseCarry`, `holdPages`, `landPageDrag`, `settle` |
| gesture-handle.ts | 227 | `landPageResize`, `handleTap`, `landed`, `pressHandle`, `move`, `release` |
| gesture-press.ts | 85 | `withSelection`, `selectMade`, `prunePages`, `pressCanvas`, `pressPage` |

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `step` (82 lines, in gesture.ts): L612 `switch (input.type) {`

<a id="canvas-editor-core-overlay-json"></a>

## *canvas/editor/core/overlay-json.ts* (119 lines) → *canvas/editor/core/overlay-json.ts*

Pattern: functions only: the file stays whole, under 400 lines; each function over 80 lines is cut into named helpers in the same file, at the lines below.

| new file | lines | what goes there |
|---|---|---|
| overlay-json.ts | 123 | `OverlayStyle`, `Box`, `Line`, `Path`, `Dot`, `ROUND`, `SQUARE`, `overlayJson` |

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `overlayJson` (87 lines, in overlay-json.ts): L86 `const handleDots = (box: { x: number; y: number; w: number; `

<a id="canvas-editor-core-overlay"></a>

## *canvas/editor/core/overlay.ts* (547 lines) → *canvas/editor/core/overlay.ts*

Pattern: pure logic, split by topic.

*overlay.ts* keeps the overlay's types and `deriveOverlay`, which calls the three; map.md named outlines and measure, and handles is added so each file stays small.

| new file | lines | what goes there |
|---|---|---|
| overlay.ts | 183 | `Offset`, `Corners`, `Outline`, `PageHandles`, `HoverBox`, `GripBox`, `DropBox`, `KinBox`, `SelectionFrame`, `MeasureLine`, `Distances`, `SideHint`, `Draft`, `RadiusHandle`, `Overlay`, `OverlayInput`, `deriveOverlay` |
| outlines.ts | 257 | `OutlineInput`, `rounded`, `NO_SHIFT`, `glideShift`, `outline`, `selectionOutlines`, `HoverInput`, `hoverBox`, `KinInput`, `kinOutlines`, `sizeLabel`, `selectionFrame`, `gripBox`, `dropBox`, `gripHidden`, `insertBox`, `draftBox`, `draftCurve` |
| handles.ts | 109 | `HANDLES_MIN_PX`, `tooSmallForHandles`, `itemHandles`, `HandleInput`, `arrowAnchors`, `radiusHandle`, `pageHandles`, `arrowEnds`, `pageHandleList`, `HANDLE_HIT_PX`, `hitReach`, `handleAt`, `anchorAt`, `radiusInset`, `radiusShown` |
| measure.ts | 55 | `measure`, `distances` |

No function stays over 80 lines.


<a id="canvas-editor-dom-OverlayLayer"></a>

## *canvas/editor/dom/OverlayLayer.tsx* (431 lines) → *canvas/editor/dom/OverlayLayer.tsx*

Pattern: view: the component's 366-line JSX is cut at its top-level children into three components; the model is *editor/core/overlay.ts* already.

The JSX moves by its top-level children (line numbers today): lines 64 to 216 (kin, outlines, selection frame, grip, hover, joins, drop, slots, insert, sides) stay in *view.tsx*; anchors 221-238, handles 350-367, radius 369-384 and page handles 385-403 become `<OverlayHandles>` in *handles.tsx*; guides 239-276, distances 281-299, arrow 300-335, route 336-342, end draft 343-349 and draft 404-427 become `<OverlayGuides>` in *guides.tsx*. `extra` carries those line counts, since the tool measures the JSX as one statement. *OverlayLayer.tsx* stays as a one-line re-export so importers do not change. The tool counts the JSX whole as the scope's own lines; after the cut `OverlayLayer` returns four components, and the 64-216 block it keeps is itself two, `<OverlayOutlines>` (64-147) and `<OverlayMarks>` (148-216), so no function stays over 80.

| new file | lines | what goes there |
|---|---|---|
| overlay/view.tsx | 192 | `ExportDeclaration@16`, `OverlayHandlers`, `o`, `many`, `ReturnStatement@64` |
| overlay/handles.tsx | 123 | `ANCHOR_OUT`, `ANCHOR_PX`, `HANDLE_PX`, `knob` |
| overlay/guides.tsx | 137 | (the entry and the shell) |

The scope `OverlayLayer` keeps 371 lines of its own **over 80: cut below**; the parts that leave it take its shared state as one `ctx` argument.

No function stays over 80 lines.


<a id="canvas-editor-dom-TextEditing"></a>

## *canvas/editor/dom/TextEditing.tsx* (483 lines) → *canvas/editor/dom/TextEditing.tsx*

Pattern: part: model (the editing state and what it returns), view (`TextEditor`), actions (opening, typing, committing).

*text/model.ts* keeps `TextHost`, `createTextEditing`'s signals and its returned object; *TextEditing.tsx* stays as a re-export of the three so importers do not change. `TextEditor`'s JSX (110 lines from line 368) is cut by hand: its toolbar and its editable box become two components.

| new file | lines | what goes there |
|---|---|---|
| text/model.ts | 130 | `TextHost`, `TextEditing`, `ExportDeclaration@482`, `doc`, `open`, `setOpen`, `textLookOf`, `shapeOf`, `cardOf`, `cardLook`, `cardInner`, `ExpressionStatement@108`, `ExpressionStatement@109`, `ExpressionStatement@133`, `typedValue`, `ExpressionStatement@176`, `ghostUntil`, `ExpressionStatement@237`, `pictureSizes`, `pictureSize`, `wordsOf`, `ReturnStatement@331` |
| text/view.tsx | 141 | `TextEditor` |
| text/actions.ts | 287 | `openShapeWords`, `openPenText`, `openFileOf`, `openCard`, `openCardAt`, `typedFrame`, `previewTyped`, `showTyped`, `dropTyped`, `penTextBox`, `unmute`, `unmuteNow`, `editorGhost`, `leaveGhost`, `dropGhost`, `commitPenText`, `cancel`, `measurePictures` |

The scope `createTextEditing` keeps 63 lines of its own; the parts that leave it take its shared state as one `ctx` argument.

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `TextEditor` (116 lines, in text/view.tsx): L366 `(`; L479 `;`
- `ArrowFunction@368` (110 lines, in text/view.tsx): L407 `return (`

<a id="canvas-editor-dom-controller"></a>

## *canvas/editor/dom/controller.ts* (305 lines) → *canvas/editor/dom/controller.ts*

Pattern: functions only: the file stays whole, under 400 lines; each function over 80 lines is cut into named helpers in the same file, at the lines below.

| new file | lines | what goes there |
|---|---|---|
| controller.ts | 306 | `HostPage`, `EditorHost`, `pointerInput`, `createEditor`, `Editor`, `ExportDeclaration@304` |

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `createEditor` (247 lines, in controller.ts): L102 `const dispatch = (input: Input) => {`; L161 `createEffect(() => {`; L189 `return {`

<a id="canvas-editor-dom-effects"></a>

## *canvas/editor/dom/effects.ts* (219 lines) → *canvas/editor/dom/effects.ts*

Pattern: functions only: the file stays whole, under 400 lines; each function over 80 lines is cut into named helpers in the same file, at the lines below.

| new file | lines | what goes there |
|---|---|---|
| effects.ts | 219 | `ReferTarget`, `ReferPill`, `EffectHost`, `createEffects` |

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `createEffects` (173 lines, in effects.ts): L103 `const mark = (target: ReferTarget, on: boolean) => {`; L164 `const openLink = (href: string) => {`

<a id="canvas-editor-editor"></a>

## *canvas/editor/editor.tsx* (352 lines) → *canvas/editor/editor.tsx*

Pattern: functions only: the file stays whole, under 400 lines; each function over 80 lines is cut into named helpers in the same file, at the lines below.

| new file | lines | what goes there |
|---|---|---|
| editor.tsx | 351 | `ExportDeclaration@22`, `fitAll`, `BLANK`, `createEditor` |

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `createEditor` (310 lines, in editor.tsx): L108 `const putCamera = (next: Camera) => {`; L153 `const editing = editable`; L195 `createComputed(() => {`; L219 `const stageView = () => (`; L264 `const root = () => (`; L282 `const handle: CanvasHandle = {`; L350 `return { handle, surface, root, dispose: () => handle.dispos`

<a id="canvas-host-inside-backend"></a>

## *canvas/host/inside/backend.ts* (196 lines) → *canvas/host/inside/backend.ts*

Pattern: functions only: the file stays whole, under 400 lines; each function over 80 lines is cut into named helpers in the same file, at the lines below.

| new file | lines | what goes there |
|---|---|---|
| backend.ts | 196 | `Backend`, `Heard`, `createBackend`, `drawingFollower` |

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `createBackend` (90 lines, in backend.ts): L85 `return {`

<a id="canvas-host-inside-boot"></a>

## *canvas/host/inside/boot.ts* (279 lines) → *canvas/host/inside/boot.ts*

Pattern: functions only: the file stays whole, under 400 lines; each function over 80 lines is cut into named helpers in the same file, at the lines below.

| new file | lines | what goes there |
|---|---|---|
| boot.ts | 279 | `FrameContext`, `openFrame`, `cardsOf`, `CardPlacerDeps`, `createCardPlacer` |

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `openFrame` (195 lines, in boot.ts): L88 `const items = () => {`; L148 `function cardItem(path: string): { id: string; metadata?: { `; L161 `return {`

<a id="canvas-host-inside-clipboard"></a>

## *canvas/host/inside/clipboard.ts* (189 lines) → *canvas/host/inside/clipboard.ts*

Pattern: functions only: the file stays whole, under 400 lines; each function over 80 lines is cut into named helpers in the same file, at the lines below.

| new file | lines | what goes there |
|---|---|---|
| clipboard.ts | 189 | `ClipboardDeps`, `freshId`, `typing`, `wordsSelected`, `needsFiles`, `installClipboard`, `sayer` |

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `installClipboard` (96 lines, in clipboard.ts): L125 `const pasteClip = async (clip: Clip) => {`

<a id="canvas-host-inside-events"></a>

## *canvas/host/inside/events.ts* (299 lines) → *canvas/host/inside/events.ts*

Pattern: functions only: the file stays whole, under 400 lines; each function over 80 lines is cut into named helpers in the same file, at the lines below.

| new file | lines | what goes there |
|---|---|---|
| events.ts | 299 | `wireFrame` |

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `wireFrame` (275 lines, in events.ts): L83 `function reread(): void {`; L107 `const stageCall = (call: StageCall) => {`; L160 `const shootCard = async (call: StageCall) => {`; L181 `if (studio)`; L230 `end.on("look", (data) => {`; L290 `addEventListener("pointerdown", () => end.emit("away", {}), `

<a id="canvas-host-inside-frame"></a>

## *canvas/host/inside/frame.tsx* (207 lines) → *canvas/host/inside/frame.tsx*

Pattern: functions only: the file stays whole, under 400 lines; each function over 80 lines is cut into named helpers in the same file, at the lines below.

| new file | lines | what goes there |
|---|---|---|
| frame.tsx | 207 | `bootFrame`, `run` |

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `run` (139 lines, in frame.tsx): L70 `createRoot((disposeRoot) => {`; L205 `;`
- `ArrowFunction@70` (136 lines, in frame.tsx): L114 `const cursors = () => (`; L151 `if (chrome) {`

<a id="canvas-host-inside-line"></a>

## *canvas/host/inside/line.ts* (125 lines) → *canvas/host/inside/line.ts*

Pattern: functions only: the file stays whole, under 400 lines; each function over 80 lines is cut into named helpers in the same file, at the lines below.

| new file | lines | what goes there |
|---|---|---|
| line.ts | 125 | `LineAnswer`, `LineOptions`, `LineClient`, `openLine` |

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `openLine` (85 lines, in line.ts): L98 `ensure();`

<a id="canvas-host-inside-options"></a>

## *canvas/host/inside/options.ts* (309 lines) → *canvas/host/inside/options.ts*

Pattern: functions only: the file stays whole, under 400 lines; each function over 80 lines is cut into named helpers in the same file, at the lines below.

| new file | lines | what goes there |
|---|---|---|
| options.ts | 309 | `PICTURE_LOOK`, `base64url`, `rectOf`, `focusOn`, `installHost`, `editorOptions` |

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `installHost` (123 lines, in options.ts): L51 `{`; L170 `)`
- `editorOptions` (131 lines, in options.ts): L181 `return {`

<a id="canvas-host-inside-presence"></a>

## *canvas/host/inside/presence.ts* (163 lines) → *canvas/host/inside/presence.ts*

Pattern: functions only: the file stays whole, under 400 lines; each function over 80 lines is cut into named helpers in the same file, at the lines below.

| new file | lines | what goes there |
|---|---|---|
| presence.ts | 168 | `Present`, `POINTER_MS`, `ACT_LINGER_MS`, `TOUR_LINGER_MS`, `TOUR_STEP_MS`, `TOUR_MOST`, `LEAVE_MS`, `installPresence` |

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `installPresence` (127 lines, in presence.ts): L78 `return {`

<a id="canvas-host-inside-studio-line"></a>

## *canvas/host/inside/studio-line.ts* (115 lines) → *canvas/host/inside/studio-line.ts*

Pattern: functions only: the file stays whole, under 400 lines; each function over 80 lines is cut into named helpers in the same file, at the lines below.

| new file | lines | what goes there |
|---|---|---|
| studio-line.ts | 115 | `StudioLine`, `createStudioLine` |

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `createStudioLine` (87 lines, in studio-line.ts): L43 `return {`

<a id="canvas-host-outside-framed-editor"></a>

## *canvas/host/outside/framed-editor.tsx* (660 lines) → *canvas/host/outside/framed-editor.tsx*

Pattern: a page part: model, view and actions beside it in host/outside/; createFramedEditor keeps its state and returns the handle, each part given that state as one ctx.

As map.md. wire (84 lines) and keepInStep (112) are cut where the sheet says, one helper per message kind.

| new file | lines | what goes there |
|---|---|---|
| framed-editor.tsx | 29 | `state`, `[end, setEnd]`, `[frameAt, setFrameAt]`, `fromFrame`, `localCamera`, `darkNow`, `modeNow`, `storage`, `storeKey`, `ReturnStatement@658` |
| model.ts | 215 | `PASSED_ON`, `frameAddress`, `FrameHostOptions`, `CanvasPass`, `RETRY_MS`, `FramedEditorOptions`, `FramedHandle`, `FramedEditor`, `Options`, `APP_STORE`, `FRAME_VIEWS`, `appStoredNow`, `onPage`, `frameLeftAt`, `frameHadFocus`, `FOCUS_GRACE`, `frameFocused`, `pressed`, `frameInUse` |
| frame-life.ts | 136 | `IfStatement@228`, `startFrame`, `renew` |
| wire.ts | 94 | `wire` |
| in-step.ts | 117 | `keepInStep` |
| view.tsx | 105 | `surface`, `handle` |

The scope `createFramedEditor` keeps 13 lines of its own; the parts that leave it take its shared state as one `ctx` argument.

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `wire` (83 lines, in wire.ts): L416 `page.on("app-store", (data) => {`
- `keepInStep` (108 lines, in in-step.ts): L509 `createEffect(() => {`

<a id="canvas-ink-InkLayer"></a>

## *canvas/ink/InkLayer.tsx* (704 lines) → *canvas/ink/InkLayer.tsx*

Pattern: a page part: model, view and actions in ink/layer/; StageInk (InkLayer in step 6) keeps its signals and wires the parts, each given them as one ctx.

As map.md, with painting the stroke (layer/paint.ts, including the two effects that repaint it) a file of its own.

| new file | lines | what goes there |
|---|---|---|
| InkLayer.tsx | 67 | `loop`, `live`, `reshape`, `inkLayer`, `shown`, `frame`, `gesture`, `zoom`, `[resizing, setResizing]`, `held`, `fingers`, `tapStarted`, `tapMost`, `tapSpoiled`, `ExpressionStatement@329`, `ExpressionStatement@330`, `ExpressionStatement@331`, `ExpressionStatement@332`, `penDown`, `penUpAt`, `palms` |
| layer/model.ts | 190 | `STAGE_INK`, `PALM_AFTER_MS`, `waiting`, `settle`, `hold`, `handedOver`, `handOver`, `Gesture`, `pressureOf`, `transform`, `selection`, `shaper`, `liveOf`, `HOLD_MS`, `startScale`, `scaled`, `palm` |
| layer/paint.ts | 155 | `sendInk`, `paintInk`, `ExpressionStatement@162`, `clearLive`, `paintLive`, `sheet`, `ExpressionStatement@586`, `ExpressionStatement@645` |
| layer/actions.ts | 267 | `erase`, `cancel`, `rest`, `fingerDown`, `fingerMove`, `fingerUp`, `onDown`, `onMove`, `onUp` |
| layer/view.tsx | 54 | `ReturnStatement@654` |

The scope `StageInk` keeps 40 lines of its own; the parts that leave it take its shared state as one `ctx` argument.

No function stays over 80 lines.


<a id="canvas-ink-shaper"></a>

## *canvas/ink/shaper.ts* (421 lines) → *canvas/ink/shaper.ts*

Pattern: pure logic, split by topic; `inkShaper` (112 lines) is cut in two.

*shaper.ts* keeps the colours, `InkStroke` and `inkShaper`; picking (hit, lasso) goes with the history, the edits made to strokes after they are drawn.

| new file | lines | what goes there |
|---|---|---|
| shaper.ts | 154 | `INK_COLORS`, `InkColor`, `InkStroke`, `InkShaper`, `inkShaper` |
| outline.ts | 183 | `round1`, `Pt`, `toPts`, `f`, `widthAt`, `strokeShape`, `centreLine`, `outline`, `simplify`, `segmentDistance`, `InkBox`, `inkBounds` |
| history.ts | 90 | `hitStroke`, `insidePolygon`, `lassoPick`, `moveStroke`, `InkHistory`, `HISTORY_DEPTH`, `inkHistory`, `inkCommit`, `inkUndo`, `inkRedo` |

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `inkShaper` (112 lines, in shaper.ts): L199 `const outlineNow = (): string => {`

<a id="canvas-input-canvas-input"></a>

## *canvas/input/canvas-input.ts* (687 lines) → *canvas/input/canvas-input.ts*

Pattern: a page part's actions, by kind of input, beside it in input/; createStageInput (createCanvasInput in step 6) keeps its state and returns the handlers, each part given that state as one ctx.

As map.md, but the touch file is canvas-touch.ts, since input/pointer/touch.ts and camera/touch.ts already name touch. The key handler (today's statement at line 95, 214 lines) is one function: the sheet cuts it.

| new file | lines | what goes there |
|---|---|---|
| canvas-input.ts | 58 | `StageInputDeps`, `{ props, ctl, view, frame, worldAt }`, `el`, `{ setPanning }`, `[spaceHeld, setSpaceHeld]`, `grabbing`, `[pressHeld, setPressHeld]`, `lastScroll`, `COAST_MS`, `{ push: pushCamera, cancelCoast, stopped: stoppedMoving }`, `ReturnStatement@666` |
| keys-shortcuts.ts | 318 | `TOOL_KEYS`, `ExpressionStatement@63`, `ExpressionStatement@95`, `shortcut`, `local`, `onHidden`, `onBlur` |
| wheel.ts | 76 | `centre`, `wheel`, `gesturing`, `nativeWheel`, `wheelCarry`, `onWheel`, `onDrawn`, `onCanvas` |
| canvas-touch.ts | 268 | `KeptTouches`, `touches`, `keptTouches`, `claimed`, `carried`, `pinched`, `caught`, `poolPans`, `panned`, `fingerOf`, `touch`, `onTouchMove`, `onTouchEnd`, `releaseCarried`, `beginTouch`, `lostTouches`, `ExpressionStatement@614`, `ExpressionStatement@615`, `ExpressionStatement@616`, `gestures`, `panFrom` |

The scope `createStageInput` keeps 16 lines of its own; the parts that leave it take its shared state as one `ctx` argument.

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `ArrowFunction@95` (214 lines, in keys-shortcuts.ts): L154 `keptTouches.changed = () => {`; L212 `const onGestureChange = (event: Event) => {`; L243 `const keydown = (event: KeyboardEvent) => {`; L303 `addEventListener("keyup", keyup);`

<a id="canvas-input-pointer"></a>

## *canvas/input/pointer.ts* (900 lines) → *canvas/input/pointer.ts*

Pattern: a page part: model and actions in input/pointer/; createPointer keeps its state and returns the handlers, each part given that state as one ctx.

As map.md, with drags and hovers as files of their own (pointer/drag.ts, pointer/hover.ts). pointer.ts keeps createPointer, its state and the returned handlers.

| new file | lines | what goes there |
|---|---|---|
| pointer.ts | 36 | `ExpressionStatement@157`, `ExpressionStatement@158`, `ReturnStatement@872` |
| pointer/model.ts | 226 | `Client`, `PageView`, `Openers`, `PointerHost`, `TEXTY`, `pressTarget`, `Pointer`, `cameraWatchers`, `pannedAt`, `pressedOn`, `notePress`, `worldAt`, `pickAtHere`, `pictureUnder`, `onDrawn`, `onCanvas`, `blockUnder`, `pageItemId`, `pageView` |
| pointer/actions.ts | 269 | `follow`, `followEditor`, `penPress`, `onDblClick`, `onPointerDown` |
| pointer/drag.ts | 139 | `fingerIn`, `dragPage`, `selectPage`, `resizeFrom`, `radiusFrom`, `resizePage`, `dragArrowEnd`, `dragArrowBend`, `dragBlock` |
| pointer/hover.ts | 124 | `hoverFrame`, `hoverAt`, `hoverPoint`, `hoverLights`, `hoverNode`, `onHover`, `ExpressionStatement@487`, `altKey`, `altGone`, `ExpressionStatement@499`, `ExpressionStatement@500`, `ExpressionStatement@501`, `ExpressionStatement@502`, `onLeave` |
| pointer/touch.ts | 237 | `lastBareTap`, `lastTap`, `tapToDeselect`, `touchOnDrawing` |

The scope `createPointer` keeps 29 lines of its own; the parts that leave it take its shared state as one `ctx` argument.

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `touchOnDrawing` (120 lines, in pointer/touch.ts): L646 `const move = (e: PointerEvent) => {`; L663 `const up = (e: PointerEvent) => {`

<a id="canvas-items-MediaPlayer"></a>

## *canvas/items/MediaPlayer.tsx* (288 lines) → *canvas/items/MediaPlayer.tsx*

Pattern: functions only: the file stays whole, under 400 lines; each function over 80 lines is cut into named helpers in the same file, at the lines below.

| new file | lines | what goes there |
|---|---|---|
| MediaPlayer.tsx | 289 | `MediaPlayerProps`, `PLAY`, `PAUSE`, `Glyph`, `MediaPlayer` |

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `MediaPlayer` (243 lines, in MediaPlayer.tsx): L92 `onMount(() => {`; L144 `if (props.kind === "audio") {`; L217 `const look = () => filmLayout(place());`; L219 `return (`

<a id="canvas-items-item-slot"></a>

## *canvas/items/item-slot.tsx* (289 lines) → *canvas/items/item-slot.tsx*

Pattern: functions only: the file stays whole, under 400 lines; each function over 80 lines is cut into named helpers in the same file, at the lines below.

| new file | lines | what goes there |
|---|---|---|
| item-slot.tsx | 290 | `EDGE_OUT_PX`, `EDGE_IN_PX`, `ItemSlotProps`, `ItemSlotExtras`, `ItemSlot` |

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `ItemSlot` (201 lines, in item-slot.tsx): L109 `const fingerDrag = (event: PointerEvent) => {`; L177 `const grip = (event: PointerEvent) => (event.pointerType ===`; L211 `return (`

<a id="canvas-items-item-surfaces"></a>

## *canvas/items/item-surfaces.tsx* (248 lines) → *canvas/items/item-surfaces.tsx*

Pattern: functions only: the file stays whole, under 400 lines; each function over 80 lines is cut into named helpers in the same file, at the lines below.

| new file | lines | what goes there |
|---|---|---|
| item-surfaces.tsx | 251 | `DARK_TOKENS`, `DocumentSurface`, `[shownApps, setShownApps]`, `appShowing`, `markShown`, `AppSurface`, `ForwardedWheel`, `forwardWheel`, `scripts`, `script`, `markdown`, `maths` |

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `AppSurface` (95 lines, in item-surfaces.tsx): L152 `return (`

<a id="canvas-render-engine"></a>

## *canvas/render/engine.ts* (2481 lines) → *canvas/render/engine.ts*

Pattern: pure logic around one class, split by topic; the class keeps its fields and constructor, and each method that leaves it becomes a function given the engine (its fields as one ctx).

The class is renamed CanvasEngine in step 6, not here. *engine.ts* keeps the fields, the constructor and one-line methods that delegate to the topic files, so `entries/` and `view/` import it as today. Beside map.md: the worker's messages (engine-worker.ts), drawing a frame (engine-draw.ts) and fetching pictures (engine-fetch.ts) are files of their own, to stay under 370.

| new file | lines | what goes there |
|---|---|---|
| engine.ts | 220 | `BAND_PX`, `REST_MS`, `page`, `worker`, `disposed`, `camera`, `view`, `scheme`, `moving`, `zooming`, `doc`, `base`, `over`, `hits`, `hitWindow`, `bandZoom`, `cardIndex`, `nodePaths`, `nodeIndex`, `indexed`, `cardBoxes`, `size`, `drawnAt`, `placedCards`, `cardKey`, `liveKey`, `viewState`, `viewKey`, `fontsAsked`, `picturesAsked`, `fonts`, `iconsAsked`, `fetching`, `lifted`, `sent`, `shownSeen`, `posted`, `postedContent`, `fontsPending`, `fontsSettled`, `sharpNext`, `settledNext`, `failed`, `drawn`, `presented`, `pictured`, `carrying`, `picturedKey`, `carryingKey`, `marksSeen`, `placed`, `bounds`, `drawnDoc`, `scrolls`, `penHit`, `drewDrawing`, `onCarryPending`, `onGlide`, `started`, `lastOps`, `backend`, `workerBackend`, `maxPicture`, `pictures`, `detected`, `unwatch`, `paused`, `restarting`, `restarts`, `picturesPut`, `cardsSent`, `recovery` |
| engine-life.ts | 228 | `framesItself`, `attachCanvas`, `recover`, `fail`, `start`, `open`, `lose`, `restart`, `tilePixels`, `afterMove`, `stageModule`, `dispose` |
| engine-doc.ts | 327 | `LayoutChanges`, `RootCard`, `RootLaid`, `setDoc`, `landing`, `drawnBoxes`, `laidOut`, `laidOutWhole`, `laid`, `cardList`, `cards`, `setView`, `fitCanvases`, `drawRect` |
| engine-camera.ts | 343 | `FAST_ZOOM`, `ZOOM_RATE_MS`, `FAST_HOLD_MS`, `SHEET_MARGIN`, `glidesWanted`, `glide`, `startGlide`, `glideFrom`, `beginGlide`, `settle`, `settling`, `whole`, `sheet`, `windowInSheet`, `holdStill`, `still`, `place`, `placedAs`, `setScheme`, `setCamera`, `overlayJson`, `setOverlay`, `setMoving`, `zoomRate`, `zoomTrail`, `fastZoom`, `fastTimer`, `corner`, `sendCamera`, `endGlide` |
| engine-tiles.ts | 270 | `pixelsFirst`, `webKit`, `TILE_BUDGET`, `tileBudget`, `tileScale`, `tileArea`, `TILE_SIDE`, `webKit`, `wantScale`, `overviewScale`, `wanted`, `dropUnwanted`, `dirty`, `fadeFrame`, `fadeLast`, `fadeSoon`, `tickFrame`, `tickSoon`, `tick`, `tileQueue`, `tileBatch`, `coarseClock`, `takeTilesSoon`, `takeChannel`, `takePosted`, `frameTaken`, `takeTiles`, `dropTileQueue`, `setTiles`, `forgetTile` |
| engine-cards.ts | 235 | `boxOf`, `setCards`, `carriedBy`, `carry`, `shown`, `carriedCount`, `carriedPaths`, `cardsOnly`, `cardsAnswered`, `cardsLanding`, `landCards`, `lift`, `moveOnly`, `cutFromCarried`, `showCarriedLayer`, `offset` |
| engine-pictures.ts | 242 | `pictureKey`, `STAND_IN_RETRY_MS`, `STAND_IN_TRIES`, `PICTURE_RETRY_MS`, `PICTURES_BATCH_MS`, `EMPTY`, `PICTURES_PER_FRAME`, `picturesSoon`, `wantCardPictures`, `unpicturedNear`, `rungBytes`, `pictureBytes`, `heldWidth`, `unpictured`, `cardByKey`, `heldBytes`, `budgetBytes`, `compressedPut`, `compressedSize`, `fitPictures`, `fitSoon`, `fitTimer`, `wantPictures` |
| engine-fonts.ts | 158 | `Font`, `wordSizes`, `wordsGeneration`, `words`, `fetchIcon`, `needFonts`, `prefetchFonts`, `prefetched`, `fetchFonts`, `giveFonts`, `postFonts` |
| engine-hits.ts | 333 | `withOutlines`, `ink`, `hide`, `muteText`, `holes`, `setWriter`, `attach`, `attachHits`, `pageIds`, `pageIdOf`, `placedList`, `placedIndex`, `list`, `index`, `windowRect`, `setNodes`, `indexNodes`, `writeHits`, `sendView`, `tileCount`, `mark`, `shows`, `onPath`, `pickAll`, `onLine`, `cardAt`, `linkAt`, `scrollBy`, `snapMove` |
| engine-worker.ts | 177 | `readCompressed`, `moduleOf`, `startWorker`, `post`, `receive` |
| engine-draw.ts | 148 | `SHOW_ANYWAY_MS`, `draw`, `flush`, `drawSoon`, `warmSoon`, `warmed`, `lowMemory`, `showAnywaySoon`, `showAnyway`, `seenAtDraw`, `drawNow`, `drawUnguarded` |
| engine-fetch.ts | 232 | `fetchable`, `FETCHES`, `putQueue`, `putFrame`, `putPaced`, `putSome`, `retryStandIn`, `fetchPicture`, `layOutPicturesSoon`, `picturesTimer`, `picture`, `preview`, `showPreview` |

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `receive` (87 lines, in engine-worker.ts): L518 `{`
- `fetchPicture` (94 lines, in engine-fetch.ts): L1824 `void fetch(url, { credentials: "same-origin" })`

<a id="canvas-styles-canvas"></a>

## *canvas/styles/canvas.css* (1700 lines) → *canvas/styles/canvas.css*

Pattern: styles, one sheet per part, beside the part; the same selectors in the same `@layer decks.surface`, so the layer decides the order, not the files.

The parts named by the map, by what each rule styles: the card editor's words (*cards/card-editor.css*) and its bar, menus and dragged pieces (*cards/card-editor-bar.css*), the media player, the bar over a card (*chrome/bar.css*), the drawn overlay (`.world > .pen-*`), apps and documents, and cards; *view/canvas.css* keeps `.stage*`, `.world` and the engine's own layers. Each sheet opens `@layer decks.surface {`, counted in its lines. *harness/page/index.css* imports each new sheet where it imported *canvas.css*, in the same place, and `cascade-order.json` is regenerated.

| new file | lines | what goes there |
|---|---|---|
| view/canvas.css | 198 | `@layer decks.surface .stage`, `@layer decks.surface .stage::-webkit-scrollbar`, `@layer decks.surface .stage-content`, `@layer decks.surface .stage-content > .world`, `@layer decks.surface .stage-fixed`, `@layer decks.surface .stage-fixed > *`, `@layer decks.surface .stage[data-panning="true"]`, `@layer decks.surface .stage[data-sliding="true"] .world`, `@layer decks.surface .world`, `@layer decks.surface .stage-engine`, `@layer decks.surface .stage-engine-over`, `@layer decks.surface .stage-notice`, `@layer decks.surface moment and is at nothing when the read is stamped and the box goes. */`, `@layer decks.surface .world > .card-slot`, `@layer decks.surface page waits here, unseen, for the move to land (`PenLayer.carry`). Kept, not unloaded. */`, `@layer decks.surface .world > .stage-sheet`, `@layer decks.surface it both start at the box's top. Sized in stage pixels, so it`, `@layer decks.surface scales with the board and a zoom writes nothing to it. */` |
| cards/card-editor-bar.css | 304 | `@layer decks.surface [data-color-scheme="dark"] .pen-card-editor .pce-sug del`, `@layer decks.surface [data-color-scheme="dark"] .pen-card-editor .pce-sug ins`, `@layer decks.surface .pen-card-editor .pce-sug del`, `@layer decks.surface .pen-card-editor .pce-sug ins`, `@layer decks.surface .pen-card-editor .pce-sug button`, `@layer decks.surface .pen-card-editor .pce-why`, `@layer decks.surface .pen-card-editor .pce-piece`, `@layer decks.surface .pen-card-editor .pce-piece[data-kind="wiki"]`, `@layer decks.surface .pen-card-editor .pce-piece[data-kind="wiki"] > .pce-ic`, `@layer decks.surface .pen-card-editor .pce-piece.pce-block`, `@layer decks.surface .pen-card-editor .pce-piece[data-kind="img"]`, `@layer decks.surface .pen-card-editor .pce-piece[data-kind="img"] img`, `@layer decks.surface .pen-card-editor .pce-piece[data-kind="img"]:has(img) > span`, `@layer decks.surface .pen-card-editor .pce-piece[data-kind="img"]:not(:has(img))`, `@layer decks.surface .pen-card-editor .pce-piece[data-kind="img"]:not(:has(img)) > span::before`, `@layer decks.surface .pen-card-editor .pce-piece.pce-dragging`, `@layer decks.surface .pen-drag-ghost`, `@layer decks.surface .stage[data-ghosting] :is(.pen-selection, .pen-selection-box, .pen-size, .pen-kin, .pen-handle, .pen-anchor)`, `@layer decks.surface .pen-card-editor .pce-ghost`, `@layer decks.surface .pen-card-editor :is(.pce-caret, .pce-line)`, `@layer decks.surface .pen-card-editor .pce-bar`, `@layer decks.surface .pen-card-editor .pce-bar[data-off]`, `@layer decks.surface .pen-card-editor .pce-bar:not([data-hidden])`, `@layer decks.surface .pen-card-editor .pce-bar[data-hidden]`, `@layer decks.surface .pen-card-editor .pce-tools`, `@layer decks.surface .pen-card-editor .pce-tools::-webkit-scrollbar`, `@layer decks.surface .pen-card-editor .pce-row`, `@layer decks.surface .pen-card-editor .pce-bar button`, `@layer decks.surface .pen-card-editor .pce-bar .pce-icon`, `@layer decks.surface .pen-card-editor .pce-bar svg`, `@layer decks.surface .pen-card-editor .pce-bar button:hover`, `@layer decks.surface .pen-card-editor .pce-bar button[aria-pressed="true"]`, `@layer decks.surface .pen-card-editor .pce-bar .pce-pick`, `@layer decks.surface .pen-card-editor .pce-bar .pce-pick svg`, `@layer decks.surface .pen-card-editor .pce-bar .pce-pick-block`, `@layer decks.surface .pen-card-editor .pce-bar .pce-pick-font`, `@layer decks.surface .pen-card-editor .pce-bar .pce-pick-font span`, `@layer decks.surface .pen-card-editor .pce-bar .pce-pick-size`, `@layer decks.surface .pen-card-editor .pce-bar .pce-sep`, `@layer decks.surface .pen-card-editor .pce-menu`, `@layer decks.surface .pen-card-editor .pce-menu[data-open]`, `@layer decks.surface .pen-card-editor .pce-bar .pce-opt`, `@layer decks.surface .pen-card-editor .pce-bar .pce-opt small`, `@layer decks.surface .pen-card-editor .pce-bar .pce-opt-h1`, `@layer decks.surface .pen-card-editor .pce-bar .pce-opt-h2`, `@layer decks.surface .pen-card-editor .pce-bar .pce-opt-h3`, `@layer decks.surface .pen-card-editor .pce-bar .pce-opt-quote`, `@layer decks.surface .pen-card-editor .pce-bar .pce-opt-code`, `@layer decks.surface .pen-card-editor .pce-bar .pce-size-small`, `@layer decks.surface .pen-card-editor .pce-bar .pce-size-large`, `@layer decks.surface .pen-card-editor .pce-bar .pce-size-huge`, `@layer decks.surface .pen-card-editor .pce-menu.pce-fonts`, `@layer decks.surface .pen-card-editor .pce-menu.pce-fonts .pce-opt`, `@layer decks.surface .pen-card-editor .pce-group`, `@layer decks.surface .pen-card-editor .pce-menu.pce-swatches[data-open]`, `@layer decks.surface .pen-card-editor .pce-menu.pce-swatches .pce-opt`, `@layer decks.surface .pen-card-editor .pce-bar .pce-sw`, `@layer decks.surface .pen-card-editor .pce-bar .pce-sw[data-hl="yellow"]`, `@layer decks.surface .pen-card-editor .pce-bar .pce-sw[data-hl="orange"]`, `@layer decks.surface .pen-card-editor .pce-bar .pce-sw[data-hl="red"]`, `@layer decks.surface .pen-card-editor .pce-bar .pce-sw[data-hl="green"]`, `@layer decks.surface .pen-card-editor .pce-bar .pce-sw[data-hl="blue"]`, `@layer decks.surface .pen-card-editor .pce-bar .pce-sw[data-hl="purple"]`, `@layer decks.surface .pen-card-editor .pce-bar .pce-swatch-fg`, `@layer decks.surface .pen-card-editor .pce-bar .pce-swatch-fg[data-fg="red"]`, `@layer decks.surface .pen-card-editor .pce-bar .pce-swatch-fg[data-fg="orange"]`, `@layer decks.surface .pen-card-editor .pce-bar .pce-swatch-fg[data-fg="yellow"]`, `@layer decks.surface .pen-card-editor .pce-bar .pce-swatch-fg[data-fg="green"]`, `@layer decks.surface .pen-card-editor .pce-bar .pce-swatch-fg[data-fg="blue"]`, `@layer decks.surface .pen-card-editor .pce-bar .pce-swatch-fg[data-fg="purple"]` |
| cards/card-editor.css | 278 | `@layer decks.surface .world > .pen-card-editor`, `@layer decks.surface .pen-card-editor .pce-body`, `@layer decks.surface .pen-card-editor .pce-body > *`, `@layer decks.surface .pen-card-editor .pce-body > :last-child`, `@layer decks.surface .pen-card-editor .pce-body > * + :is(h1, h2, h3, h4, h5, h6)`, `@layer decks.surface .pen-card-editor :is(h1, h2, h3, h4, h5, h6)`, `@layer decks.surface .pen-card-editor h1`, `@layer decks.surface .pen-card-editor h2`, `@layer decks.surface .pen-card-editor h3`, `@layer decks.surface .pen-card-editor h4`, `@layer decks.surface .pen-card-editor h5`, `@layer decks.surface .pen-card-editor h6`, `@layer decks.surface .pen-card-editor :is(ul, ol)`, `@layer decks.surface .pen-card-editor ol`, `@layer decks.surface .pen-card-editor :is(ul, ol) ul`, `@layer decks.surface .pen-card-editor li::marker`, `@layer decks.surface .pen-card-editor li + li`, `@layer decks.surface .pen-card-editor li > :is(ul, ol, p)`, `@layer decks.surface .pen-card-editor ul[data-loose] > li + li,`, `@layer decks.surface .pen-card-editor ol[data-loose] > li + li`, `@layer decks.surface .pen-card-editor li:has(> .pce-check)`, `@layer decks.surface .pen-card-editor .pce-check`, `@layer decks.surface .pen-card-editor .pce-check[data-on]`, `@layer decks.surface .pen-card-editor blockquote`, `@layer decks.surface .pen-card-editor blockquote > p`, `@layer decks.surface .pen-card-editor blockquote > p + p`, `@layer decks.surface .pen-card-editor blockquote[data-callout]`, `@layer decks.surface .pen-card-editor blockquote[data-tone="cyan"]`, `@layer decks.surface .pen-card-editor blockquote[data-tone="green"]`, `@layer decks.surface .pen-card-editor blockquote[data-tone="orange"]`, `@layer decks.surface .pen-card-editor blockquote[data-tone="red"]`, `@layer decks.surface .pen-card-editor blockquote[data-tone="purple"]`, `@layer decks.surface .pen-card-editor blockquote[data-tone="gray"]`, `@layer decks.surface .pen-card-editor .pce-chead`, `@layer decks.surface .pen-card-editor table.pce-table`, `@layer decks.surface .pen-card-editor .pce-table :is(th, td)`, `@layer decks.surface .pen-card-editor .pce-table :is(th, td):first-child`, `@layer decks.surface .pen-card-editor .pce-table :is(th, td):last-child`, `@layer decks.surface .pen-card-editor .pce-table th`, `@layer decks.surface .pen-card-editor .pce-table tr:last-child td`, `@layer decks.surface .pen-card-editor code`, `@layer decks.surface .pen-card-editor pre.pce-code`, `@layer decks.surface .pen-card-editor a[data-href]`, `@layer decks.surface .pen-card-editor mark`, `@layer decks.surface .pen-card-editor mark[data-c="red"]`, `@layer decks.surface .pen-card-editor mark[data-c="orange"]`, `@layer decks.surface .pen-card-editor mark[data-c="green"]`, `@layer decks.surface .pen-card-editor mark[data-c="blue"]`, `@layer decks.surface .pen-card-editor mark[data-c="purple"]`, `@layer decks.surface .pen-card-editor [data-size="small"]`, `@layer decks.surface .pen-card-editor [data-size="large"]`, `@layer decks.surface .pen-card-editor [data-size="huge"]`, `@layer decks.surface .pen-card-editor [data-fg="red"]`, `@layer decks.surface .pen-card-editor [data-fg="orange"]`, `@layer decks.surface .pen-card-editor [data-fg="yellow"]`, `@layer decks.surface .pen-card-editor [data-fg="green"]`, `@layer decks.surface .pen-card-editor [data-fg="blue"]`, `@layer decks.surface .pen-card-editor [data-fg="purple"]`, `@layer decks.surface [data-color-scheme="dark"] .pen-card-editor mark`, `@layer decks.surface [data-color-scheme="dark"] .pen-card-editor mark[data-c="red"]`, `@layer decks.surface [data-color-scheme="dark"] .pen-card-editor mark[data-c="orange"]`, `@layer decks.surface [data-color-scheme="dark"] .pen-card-editor mark[data-c="green"]`, `@layer decks.surface [data-color-scheme="dark"] .pen-card-editor mark[data-c="blue"]`, `@layer decks.surface [data-color-scheme="dark"] .pen-card-editor mark[data-c="purple"]`, `@layer decks.surface [data-color-scheme="dark"] .pen-card-editor [data-fg="red"]`, `@layer decks.surface [data-color-scheme="dark"] .pen-card-editor [data-fg="orange"]`, `@layer decks.surface [data-color-scheme="dark"] .pen-card-editor [data-fg="yellow"]`, `@layer decks.surface [data-color-scheme="dark"] .pen-card-editor [data-fg="green"]`, `@layer decks.surface [data-color-scheme="dark"] .pen-card-editor [data-fg="blue"]`, `@layer decks.surface [data-color-scheme="dark"] .pen-card-editor [data-fg="purple"]`, `@layer decks.surface .pen-card-editor .pce-atom`, `@layer decks.surface .pen-card-editor .pce-faint`, `@layer decks.surface .pen-card-editor div.pce-raw,`, `@layer decks.surface .pen-card-editor pre.pce-rawedit`, `@layer decks.surface .pen-card-editor pre.pce-rawedit`, `@layer decks.surface .pen-card-editor div.pce-held`, `@layer decks.surface .pen-card-editor .pce-rule` |
| items/player.css | 214 | `@layer decks.surface .world > .pen-player`, `@layer decks.surface .world > .pen-player button,`, `@layer decks.surface .world > .pen-player [role="slider"]`, `@layer decks.surface .world > .pen-player[data-kind="video"]`, `@layer decks.surface .world > .pen-player > video`, `@layer decks.surface .world > .pen-player .pen-player-big`, `@layer decks.surface .world > .pen-player[data-paused] .pen-player-big`, `@layer decks.surface .world > .pen-player .pen-player-big:hover`, `@layer decks.surface .world > .pen-player .pen-player-big svg`, `@layer decks.surface .world > .pen-player .pen-player-bar`, `@layer decks.surface .world > .pen-player:is([data-near], [data-paused]) .pen-player-bar`, `@layer decks.surface .world > .pen-player .pen-player-bar button`, `@layer decks.surface .world > .pen-player .pen-player-bar button:hover`, `@layer decks.surface .world > .pen-player .pen-player-bar svg`, `@layer decks.surface .world > .pen-player .pen-player-bar svg[fill="none"]`, `@layer decks.surface .world > .pen-player .pen-player-clock`, `@layer decks.surface .world > .pen-player .pen-player-track`, `@layer decks.surface .world > .pen-player .pen-player-track::before,`, `@layer decks.surface .world > .pen-player .pen-player-track > i`, `@layer decks.surface .world > .pen-player .pen-player-track::before`, `@layer decks.surface .world > .pen-player .pen-player-track > i`, `@layer decks.surface .world > .pen-player[data-kind="audio"] > audio`, `@layer decks.surface .world > .pen-player[data-kind="audio"] > *`, `@layer decks.surface .world > .pen-player .pen-player-disc`, `@layer decks.surface .world > .pen-player .pen-player-disc:hover`, `@layer decks.surface .world > .pen-player .pen-player-disc:active`, `@layer decks.surface .world > .pen-player .pen-player-disc svg`, `@layer decks.surface .world > .pen-player .pen-player-name`, `@layer decks.surface .world > .pen-player .pen-player-time`, `@layer decks.surface .world > .pen-player .pen-player-wave`, `@layer decks.surface .world > .pen-player .pen-player-wave > i` |
| chrome/bar.css | 158 | `@layer decks.surface .bar-layer .chrome[data-sizing="true"],`, `@layer decks.surface .stage-fixed > .bar-layer`, `@layer decks.surface .stage-fixed > .bar-layer[data-hidden="true"]`, `@layer decks.surface .stage-fixed > .bar-layer[data-low="true"] .chrome :is(.title, .file)`, `@layer decks.surface .bar-layer .chrome[data-tight] .acts`, `@layer decks.surface .stage-fixed > .bar-layer[data-moving="true"] .chrome`, `@layer decks.surface .stage-fixed > .bar-layer:not([data-moving="true"]) .chrome`, `@layer decks.surface .bar-layer .chrome`, `@layer decks.surface .bar-layer .chrome[data-dragging="true"]`, `@layer decks.surface .bar-layer .chrome .title`, `@layer decks.surface .bar-layer .chrome[data-selected] .title`, `@layer decks.surface .bar-layer .chrome .file`, `@layer decks.surface .bar-layer .chrome .acts`, `@layer decks.surface .bar-layer .chrome:not(:hover, [data-hover="true"], [data-selected]) .acts`, `@layer decks.surface .bar-layer .chrome .act`, `@layer decks.surface .bar-layer .chrome .act:hover`, `@layer decks.surface .bar-layer .chrome .act[aria-pressed="true"]`, `@layer decks.surface .bar-layer .chrome .act svg`, `@layer decks.surface .bar-layer .chrome .act.hide`, `@layer decks.surface .bar-layer .chrome .act.hide::before` |
| editor/dom/overlay.css | 346 | `@layer decks.surface .stage[data-engine-overlays="true"] .world > :is(.pen-kin, .pen-selection, .pen-selection-box, .pen-hover, .pen-join, .pen-insert, .pen-slots, .pen-slot-frame, .pen-guides, .pen-measure, .pen-draft, .pen-draft-line, .pen-side)`, `@layer decks.surface .stage[data-engine-overlays="true"] .world > :is(.pen-handle, .pen-anchor)`, `@layer decks.surface .world > .pen-selection[data-sizing="true"]`, `@layer decks.surface .world[data-sizing="true"] > .pen-handle`, `@layer decks.surface .world > .pen-hits`, `@layer decks.surface .world > .pen-hits > .pen-hit`, `@layer decks.surface .world > :is(.pen-selection, .pen-selection-box, .pen-size, .pen-kin, .pen-measure, .pen-measure-tag, .pen-hover, .pen-join, .pen-insert, .pen-slots, .pen-slot-frame, .pen-guides, .pen-handle, .pen-text, .pen-draft, .pen-draft-line)`, `@layer decks.surface .world > .pen-kin`, `@layer decks.surface .world > .pen-kin[data-kin="child"]`, `@layer decks.surface .world > .pen-kin[data-round="true"]`, `@layer decks.surface .world > .pen-selection-box`, `@layer decks.surface .world > .pen-size`, `@layer decks.surface .world > :is(.pen-hover, .pen-join)`, `@layer decks.surface .world > .pen-join`, `@layer decks.surface .world > .pen-grip`, `@layer decks.surface .world > .pen-grip:hover`, `@layer decks.surface .world > .pen-grip:active`, `@layer decks.surface .world > .pen-grip[data-hidden]`, `@layer decks.surface .world > .pen-grip svg`, `@layer decks.surface .world > .pen-insert`, `@layer decks.surface .world > .pen-slots`, `@layer decks.surface .world > .pen-slots line`, `@layer decks.surface .world > .pen-slot-frame`, `@layer decks.surface .world > :is(.pen-hover, .pen-selection):is([data-page="true"], [data-round="true"])`, `@layer decks.surface .world > .pen-guides`, `@layer decks.surface .world > .pen-guides :is(line, path)`, `@layer decks.surface .world > .pen-measure`, `@layer decks.surface .world > .pen-measure :is(line, rect)`, `@layer decks.surface .world > .pen-measure-tag`, `@layer decks.surface .world > .pen-selection`, `@layer decks.surface .world > .pen-handle`, `@layer decks.surface .world > .pen-handle[data-handle]:not([data-handle="radius"])::before`, `@layer decks.surface .world > .pen-handle:is([data-handle="nw"], [data-handle="se"])`, `@layer decks.surface .world > .pen-handle:is([data-handle="ne"], [data-handle="sw"])`, `@layer decks.surface .world > .pen-handle:is([data-handle="n"], [data-handle="s"])`, `@layer decks.surface .world > .pen-handle:is([data-handle="e"], [data-handle="w"])`, `@layer decks.surface .world > .pen-handle[data-handle="radius"]`, `@layer decks.surface .world > .pen-draft`, `@layer decks.surface .world > .pen-draft[data-tool="ellipse"]`, `@layer decks.surface .world > .pen-draft-line`, `@layer decks.surface .stage[data-pen-tool]`, `@layer decks.surface .stage[data-pen-tool] .world > .card-slot > .card-node`, `@layer decks.surface .world > .pen-text`, `@layer decks.surface .world > .pen-text[data-grows="wide"]`, `@layer decks.surface .world > .pen-side,`, `@layer decks.surface .world > .pen-anchor`, `@layer decks.surface .world > .pen-side`, `@layer decks.surface .world > .pen-side[data-on="true"]`, `@layer decks.surface .world > .pen-anchor`, `@layer decks.surface .world > .pen-anchor:hover` |
| items/items.css | 223 | `@layer decks.surface .stage[data-scaling="true"] .card-node :is(.card-host, .document-surface)`, `@layer decks.surface .card-node[data-asleep] :is(.card-surface, .document-surface, .app-surface)`, `@layer decks.surface .world > .file-live`, `@layer decks.surface .world > .file-live > img`, `@layer decks.surface .world > .card-slot > .card-node > .agent-cursor`, `@layer decks.surface .card-node > .plain-card-bar`, `@layer decks.surface .plain-card-bar`, `@layer decks.surface .card-scripts-off`, `@layer decks.surface :where(.decks-canvas, .decks-layer) .app-surface`, `@layer decks.surface [data-color-scheme="dark"] :where(.decks-canvas, .decks-layer) .app-surface`, `@layer decks.surface :where(.decks-canvas, .decks-layer) .card-node > .app-grip`, `@layer decks.surface :where(.decks-canvas, .decks-layer) .app-surface-body`, `@layer decks.surface :where(.decks-canvas, .decks-layer) .app-surface-body p`, `@layer decks.surface :where(.decks-canvas, .decks-layer) .app-surface-open`, `@layer decks.surface :where(.decks-canvas, .decks-layer) .app-surface-open:hover`, `@layer decks.surface :where(.decks-canvas, .decks-layer) .app-surface-frame`, `@layer decks.surface :where(.decks-canvas, .decks-layer) .card-node[data-covered] .document-surface`, `@layer decks.surface :where(.decks-canvas, .decks-layer) .card-node[data-covered] .app-surface-frame`, `@layer decks.surface [data-color-scheme="dark"] :where(.decks-canvas, .decks-layer) .app-surface-frame`, `@layer decks.surface :where(.decks-canvas, .decks-layer) .document-surface .dp` |
| cards/card.css | 223 | `@layer decks.surface .stage[data-card-pictures="true"] .card-node .card-surface`, `@layer decks.surface .stage[data-card-pictures="true"] .card-node .card-host`, `@layer decks.surface .stage[data-engine] .card-node > .surface`, `@layer decks.surface .card-node`, `@layer decks.surface .card-node[data-sizing="true"],`, `@layer decks.surface .card-node[data-sizing="true"] > .surface,`, `@layer decks.surface .card-node[data-outlined] > .shade`, `@layer decks.surface .card-node > .shade`, `@layer decks.surface .card-node > .news-glow`, `@layer decks.surface .card-node > .news-glow::after`, `@layer decks.surface .stage[data-moving="true"] .card-node > .news-glow::after`, `@layer decks.surface .stage[data-carrying="true"] .card-node > .news-glow`, `@layer decks.surface .stage:not([data-carrying="true"]) .card-node > .news-glow`, `@layer decks.surface .card-node > .news-glow[data-reading]`, `@layer decks.surface .card-node > .surface`, `@layer decks.surface .card-node > .touch-cover`, `@layer decks.surface .card-node[data-active] > .surface`, `@layer decks.surface .card-node[data-carried] > :is(.shade, .surface)`, `@layer decks.surface .card-node > .surface > .edge`, `@layer decks.surface .card-node > .surface > .edge > rect`, `@layer decks.surface .card-node > .surface > .placeholder`, `@layer decks.surface .stage .card-edge`, `@layer decks.surface .card-node .placeholder`, `@layer decks.surface .stage[data-previewing="true"] .card-node > .shade` |

No function stays over 80 lines.


<a id="canvas-view-CanvasView"></a>

## *canvas/view/CanvasView.tsx* (938 lines) → *canvas/view/CanvasView.tsx*

Pattern: a page part: model, view and actions in view/; the Stage component (CanvasView in step 6) keeps its signals and elements and wires the parts, each given them as one ctx.

Beside map.md: the effects that keep the engine, the overlays and the ink in step (today's statements from line 558 to 775) are view/effects.ts, and the returned JSX is view/markup.tsx, so the component itself stays under 80 lines.

| new file | lines | what goes there |
|---|---|---|
| CanvasView.tsx | 95 | `ExportDeclaration@62`, `element`, `worldEl`, `cameraChanged`, `[view, setView]`, `[worldOrigin, setWorldOrigin]`, `[worldPlaced, setWorldPlaced]`, `{ moving, scaling, gliding, panning }`, `[holdMenu, setHoldMenu]`, `{ grabbing }`, `ExpressionStatement@373`, `[engineNotice, setEngineNotice]`, `ExpressionStatement@376`, `ExpressionStatement@377`, `ExpressionStatement@383`, `ExpressionStatement@384`, `[penDrawn, setPenDrawn]`, `[engineOverlays, setEngineOverlays]` |
| model.ts | 305 | `StageProps`, `Frame`, `origin`, `worldFor`, `ownScroll`, `placeWorld`, `placeScroll`, `zoomScroll`, `zoomStill`, `placedZoom`, `worldAt`, `freshId`, `freshIds`, `penNode`, `scenePages`, `scene`, `resolvedColours`, `resolveColour`, `colourProbe`, `colours`, `coloursFor`, `inkStrokes`, `readFor`, `frameUnder`, `dropSlot`, `overLink`, `fitted` |
| actions.ts | 194 | `ctl`, `ExpressionStatement@275`, `ExpressionStatement@284`, `ExpressionStatement@300`, `scrolled`, `frame`, `penEdit`, `input`, `penLayer`, `ExpressionStatement@390`, `items`, `armPenTool`, `penMoveBy` |
| effects.ts | 159 | `ExpressionStatement@558`, `ExpressionStatement@579`, `ExpressionStatement@611`, `ExpressionStatement@618`, `ExpressionStatement@634`, `ExpressionStatement@647`, `ExpressionStatement@649`, `ExpressionStatement@660`, `Block@665`, `ExpressionStatement@684`, `ExpressionStatement@694`, `ExpressionStatement@707`, `ExpressionStatement@713`, `ExpressionStatement@728`, `ExpressionStatement@770` |
| editor-wiring.ts | 145 | `editor`, `selection` |
| markup.tsx | 185 | `ReturnStatement@776` |

The scope `Stage` keeps 41 lines of its own; the parts that leave it take its shared state as one `ctx` argument.

No function stays over 80 lines.


<a id="canvas-view-items-layer"></a>

## *canvas/view/items-layer.tsx* (754 lines) → *canvas/view/items-layer.tsx*

Pattern: a page part: model, view and actions in items/layer/ (map.md); createItemsLayer keeps its signals and returns the layer, each part given them as one ctx.

The parts go to items/layer/ as map.md says; view/items-layer.tsx keeps createItemsLayer, its signals and the returned layer, so CanvasView imports it as before.

| new file | lines | what goes there |
|---|---|---|
| items-layer.tsx | 86 | `{ props, Frame, ctl, view, editor, penLayer, penDrawn, resolveColour, frame, gestures }`, `{ moving, scaling, gliding, panning, push: pushCamera }`, `[cardPictures, setCardPictures]`, `[liveCards, setLiveCards]`, `[holesShown, setHolesShown]`, `holesAsked`, `[playing, setPlaying]`, `playingElement`, `playingSince`, `playedTo`, `[appStates, setAppStates]`, `appWatched`, `[carriedPages, setCarriedPages]`, `[picturedNow, setPicturedNow]`, `[leaving, setLeaving]`, `awakeBefore`, `[activeItem, setActiveItem]`, `[sizingPaths, setSizingPaths]`, `lastSizes`, `sizingTimers`, `ReturnStatement@752` |
| ../items/layer/model.ts | 282 | `ItemsLayerDeps`, `BUDGET`, `PINCH_ON_PICTURES`, `COVER`, `cardsHidden`, `LAYER_BUDGET`, `covering`, `draggedAsPicture`, `LiveFile`, `LIVE_FILES`, `cardsOnScreen`, `pageCamera`, `nearPaths`, `isNear`, `isVisible`, `liveNow`, `pageIndex`, `pageSlot`, `reach`, `awakeItems`, `cardChoice`, `livePaths`, `keptPaths`, `leavingPaths`, `isLeaving`, `isPictured`, `isKept`, `isLive`, `rendered`, `slotPaths`, `isRendered`, `renderedPaths`, `layered`, `restCamera`, `SIZE_MS`, `SETTLE_MS` |
| ../items/layer/actions.ts | 266 | `Block@80`, `markLive`, `toggleMedia`, `ExpressionStatement@171`, `ExpressionStatement@186`, `ExpressionStatement@204`, `ExpressionStatement@270`, `ExpressionStatement@273`, `ExpressionStatement@275`, `ExpressionStatement@306`, `playingBox`, `ExpressionStatement@338`, `ExpressionStatement@391`, `ExpressionStatement@392`, `ExpressionStatement@407`, `ExpressionStatement@418`, `ExpressionStatement@492`, `ExpressionStatement@542`, `openLiveFile`, `ExpressionStatement@576`, `ExpressionStatement@622`, `ExpressionStatement@647` |
| ../items/layer/view.tsx | 204 | `liveFiles`, `fileHoles`, `liveBox`, `pageNode`, `presented`, `slots`, `fileNodes`, `player` |

The scope `createItemsLayer` keeps 61 lines of its own; the parts that leave it take its shared state as one `ctx` argument.

No function stays over 80 lines.


<a id="canvas-view-selection"></a>

## *canvas/view/selection.tsx* (452 lines) → *canvas/view/selection.tsx*

Pattern: part: model (what the selection derives), view (the pills, the overlay it feeds), actions (delete, duplicate).

map.md's model/view/actions, plus *overlay.ts* for the many small values that feed the overlay layer, so the model stays short. `pills` (135 lines) is cut below. `pills` is one JSX fragment (lines 315-448): each pill kind (drawn items, a card, a page, a callout) becomes its own component in *view.tsx*.

| new file | lines | what goes there |
|---|---|---|
| selection/model.ts | 76 | `SelectionDeps`, `{ props, ctl, view, editor, scene, penLayer, penDrawn, frame, penEdit, freshIds, penNode, pressHeld }`, `{ moving, scaling, gliding, panning, push: pushCamera }`, `groupPicked`, `calloutPage`, `calloutPath`, `selectMade`, `shownDrag`, `stagePenPath`, `ReturnStatement@450` |
| selection/view.tsx | 166 | `pills` |
| selection/overlay.ts | 170 | `penOutlines`, `penHandles`, `penAnchors`, `ExpressionStatement@110`, `pageHandles`, `dropBox`, `radiusHandle`, `arrowEnds`, `gripBox`, `hoverBox`, `kinBoxes`, `penFrame`, `penDistances`, `routeShown`, `overlay` |
| selection/actions.ts | 137 | `pillObstacles`, `quoteOf`, `penDeleteSelected`, `penDuplicate`, `lassoItems`, `calloutItems` |

The scope `createSelection` keeps 14 lines of its own; the parts that leave it take its shared state as one `ctx` argument.

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `pills` (135 lines, in selection/view.tsx): L315 `<>`; L448 `)`

<a id="engine-doc-lib"></a>

## *engine/crates/doc/src/lib.rs* (600 lines) → *engine/crates/doc/src/lib.rs*

Pattern: Rust modules by topic; methods that leave an impl stay methods, in a second `impl X` block in the new module, which Rust allows within one crate.

lib.rs keeps Document, its constructor and its reads (len, get, walk, positions), declares `mod json; mod apply; mod node; mod history;` beside `pub mod edits; pub mod frac;`, and says `pub use node::{Handle, Node, Change, DocError, Applied, Props}; pub use history::{History, Ids};` so the crate's public names stay. apply_one (114 lines) is cut in phase 2 by op (insert, update, replace, delete, move, copy).

| new file | lines | what goes there |
|---|---|---|
| lib.rs | 125 | `edits`, `frac`, `Document`, `tests`, `new`, `alloc`, `len`, `is_empty`, `capacity`, `handle`, `node`, `root_of`, `get`, `child_list`, `has_children`, `walk`, `pos_last`, `pos_next_to` |
| json.rs | 89 | `parse`, `from_json`, `read_children`, `to_json`, `to_text`, `subtree_json`, `node_json` |
| apply.rs | 215 | `insert_at`, `apply`, `apply_each`, `parent_handle`, `find`, `slot_for`, `apply_one`, `detach`, `subtree_inserts`, `remove_subtree` |
| node.rs | 78 | `Props`, `Handle`, `Node`, `impl Node`, `Change`, `DocError`, `impl DocError`, `impl DocError`, `fail`, `Applied` |
| history.rs | 87 | `Ids`, `impl Ids`, `base36`, `History`, `impl History` |

No function stays over 80 lines.


<a id="engine-gpu-lib"></a>

## *engine/crates/gpu/src/lib.rs* (402 lines) → *engine/crates/gpu/src/lib.rs*

Pattern: Rust modules by topic; methods that leave an impl stay methods, in a second `impl X` block in the new module, which Rust allows within one crate.

lib.rs keeps Api, Gpu, the rest of its first `impl Gpu` and the `impl Backend for Gpu`, and declares `mod spares; mod pictures;` beside `pub mod exec; pub mod targets;`. Both new modules hold `impl Gpu` blocks, so no public name changes. The lister names both impl blocks `impl Gpu`; the spec splits the first (inherent) one.

| new file | lines | what goes there |
|---|---|---|
| lib.rs | 195 | `exec`, `targets`, `SAMPLES`, `Api`, `impl Api`, `ASTC`, `Gpu`, `impl Gpu`, `tests`, `new`, `on`, `api`, `lost_flag`, `make_texture`, `adopt` |
| spares.rs | 96 | `warm`, `forget_to_spare`, `texture_from_spare`, `make_spares`, `texture_handle`, `read` |
| pictures.rs | 88 | `picture_texture`, `compressed_pictures`, `compressed_picture`, `write_level`, `fill_levels`, `shrink` |

No function stays over 80 lines.


<a id="engine-gpu-tests"></a>

## *engine/crates/gpu/src/tests.rs* (651 lines) → *engine/crates/gpu/src/tests.rs*

Pattern: test modules by subject, under tests/; shared helpers in tests/mod.rs.

tests.rs becomes tests/mod.rs (gpu, px, save, write_png, webgl2_gpu) with `mod effects; mod canvases; mod goldens; mod resources;`; lib.rs's `mod tests;` is unchanged. The test names keep the word `stage` where they have it (crates are exempt).

| new file | lines | what goes there |
|---|---|---|
| tests/mod.rs | 41 | `gpu`, `px`, `save`, `write_png`, `webgl2_gpu` |
| tests/effects.rs | 143 | `draw_shapes`, `shapes_have_exact_soft_edges`, `draw_effects`, `layers_clips_gradients_shadows_and_meshes`, `angular_gradients_go_round`, `inner_shadows_lie_inside`, `blurs_soften_an_item_and_nothing_else`, `a_blur_across_tiles_has_no_seam` |
| tests/canvases.rs | 173 | `stages`, `draw_stage`, `real_stages_draw`, `fonts`, `draw_words`, `words_are_crisp`, `draw_card`, `cards_are_drawn`, `webgl2_limits_draw_the_same`, `one_sample_draws`, `one_sample_draws_what_four_do` |
| tests/goldens.rs | 95 | `read_golden`, `GOLDEN_DELTA`, `GOLDEN_SHARE`, `differ`, `golden`, `fixtures_match_their_goldens` |
| tests/resources.rs | 192 | `page_frame_cost`, `kept_resources_draw_the_same`, `draw_bench`, `spares_come_back_and_warming_draws_the_same`, `a_pictures_smaller_sizes_are_its_averages_and_shrinking_keeps_them`, `astc_flat`, `a_compressed_picture_is_written_as_it_came_and_shrinks_by_whole_blocks` |

No function stays over 80 lines.


<a id="engine-paint-painter"></a>

## *engine/crates/paint/src/painter.rs* (1174 lines) → *engine/crates/paint/src/painter.rs*

Pattern: Rust modules by topic; free functions move whole.

painter.rs keeps the icon types, Context, Writer, Scope, paint_area, ancestors, open and close, and adds `mod paint_fill; mod paint_stroke; mod paint_ops; mod paint_marks; mod paint_words;` as private siblings (`use super::*` inside each), with `pub use paint_ops::{LiveInk, paint_ink};` so the crate's public names stay. own_ops (140 lines) is cut in phase 2 by item kind (frame, shape, text, card, media).

| new file | lines | what goes there |
|---|---|---|
| painter.rs | 215 | `NOTE_RADIUS`, `IconShape`, `IconPart`, `icon_key`, `Context`, `Writer`, `impl Context`, `Scope`, `paint_area`, `ancestors`, `open`, `close` |
| paint_fill.rs | 172 | `layer_blur`, `opacity`, `to_affine`, `fade`, `rrect`, `color`, `fills_of`, `paint_of`, `shadows`, `inner_shadows` |
| paint_stroke.rs | 179 | `Stroke`, `stroke_of`, `dash_of`, `shape_stroke`, `path_ops`, `halfway`, `dashes` |
| paint_ops.rs | 180 | `ARROW`, `CARD`, `OLD_CARD`, `MARKDOWN`, `MEDIA`, `meta_type`, `LiveInk`, `paint_ink`, `own_ops` |
| paint_marks.rs | 141 | `PLACEHOLDER_ACCENT`, `PLACEHOLDER_LINE`, `PLACEHOLDER_DASH`, `PLACEHOLDER_TAG_INSET`, `PLACEHOLDER_TAG_PAD`, `placeholder_mark`, `arrow_label`, `card_paper`, `card_paper_colour`, `browser_frame`, `frame_parts`, `has_frame`, `card_edge` |
| paint_words.rs | 276 | `text_ink`, `words`, `label`, `MAX_GLYPH_PX`, `draw_laid`, `card_words`, `draw_card`, `icon` |

No function stays over 80 lines.


<a id="engine-scene-layout"></a>

## *engine/crates/scene/src/layout.rs* (433 lines) → *engine/crates/scene/src/layout.rs*

Pattern: Rust modules by topic; methods that leave an impl stay methods, in a second `impl X` block in the new module, which Rust allows within one crate.

layout.rs keeps Ctx, place, frame_content, layout and the constants, declares `mod layout_size;` (in `layout/`) and says `pub use layout_size::{Estimate, Measure, TextStyle};`. frame_content (100 lines) is cut in phase 2 at its axes (main, cross, wrap).

| new file | lines | what goes there |
|---|---|---|
| layout.rs | 215 | `DEFAULT_FONT`, `DEFAULT_FONT_SIZE`, `NOTE_PAD`, `NOTE_WIDTH`, `Sizing`, `Placed`, `Ctx`, `TEXTY`, `Content`, `fixed_or`, `layout`, `item`, `visible`, `x_y`, `frame_content`, `place` |
| layout_size.rs | 202 | `TextStyle`, `Measure`, `Estimate`, `wide`, `impl Estimate`, `text_style`, `sizing`, `default_sizing`, `text_style`, `size_of`, `text_size` |

No function stays over 80 lines.


<a id="engine-scene-lib"></a>

## *engine/crates/scene/src/lib.rs* (517 lines) → *engine/crates/scene/src/lib.rs*

Pattern: Rust modules by topic; methods that leave an impl stay methods, in a second `impl X` block in the new module, which Rust allows within one crate.

lib.rs keeps VERSIONS, Scene, new, update and build, adds `mod scene_query; mod rect; mod root; mod blur;` beside its six `pub mod`s, and says `pub use rect::Rect; pub use root::{Root, Updated, Hit}; pub use blur::{blur_radius, blur_spill};`. update (103 lines) is cut in phase 2 at its passes (diff, rebuild, index).

| new file | lines | what goes there |
|---|---|---|
| lib.rs | 204 | `arrows`, `geometry`, `index`, `layout`, `tree`, `values`, `VERSIONS`, `Scene`, `tests`, `new`, `update`, `build` |
| scene_query.rs | 119 | `find`, `placeholders`, `extent`, `extent_of`, `root`, `query`, `pick`, `pick_all`, `within`, `hits` |
| rect.rs | 39 | `Rect`, `impl Rect` |
| root.rs | 82 | `Root`, `impl Root`, `Updated`, `Hit` |
| blur.rs | 67 | `blur_radius`, `blur_spill`, `reach`, `is_reusable` |

No function stays over 80 lines.


<a id="engine-shot-lib"></a>

## *engine/crates/shot/src/lib.rs* (579 lines) → *engine/crates/shot/src/lib.rs*

Pattern: Rust modules by topic; methods that leave an impl stay methods, in a second `impl X` block in the new module, which Rust allows within one crate.

lib.rs keeps the constants, Laid and the Shooter struct, declares `mod shooter; mod shoot; mod request;` and says `pub use request::{Font, Card, Request, Needs, Picture, request_of}; pub use shoot::encode;` so the crate's public names stay. shoot (144 lines) is cut in phase 2 at its stages (lay out, upload, draw, read back).

| new file | lines | what goes there |
|---|---|---|
| lib.rs | 57 | `OUT`, `TILE_PX`, `BOARD_RADIUS`, `Laid`, `Shooter`, `CARD_PICTURES`, `tests` |
| shooter.rs | 225 | `open`, `on`, `add_font`, `add_card`, `add_picture`, `add_icon`, `upload`, `texture_id`, `card_picture`, `lay_out`, `set_reader`, `size_pictures`, `font_needs`, `needs` |
| shoot.rs | 173 | `unpremultiply`, `encode`, `shoot` |
| request.rs | 105 | `Font`, `Card`, `Request`, `Needs`, `impl Needs`, `Picture`, `request_of` |

No function stays over 80 lines.


<a id="engine-text-card"></a>

## *engine/crates/text/src/card.rs* (545 lines) → *engine/crates/text/src/card.rs*

Pattern: Rust modules by topic; methods that leave an impl stay methods, in a second `impl X` block in the new module, which Rust allows within one crate.

card.rs keeps Brush, CardOp, Card, Frame, Opts, Setter, Para, `para`, `place`, `stack` and `layout`, and declares `mod card_one; mod card_table; mod card_marks;` (as children of `card`, in `card/`), with `pub use card_marks::{check_colours, bar_colours};`. map.md named a *card_setter.rs*; `para` and `one` are the setter's bulk, so they split as card.rs and card_one.rs instead. `one` (138) and `para` (110) are cut in phase 2 by block kind.

| new file | lines | what goes there |
|---|---|---|
| card.rs | 219 | `Rgba`, `Brush`, `CardOp`, `Card`, `HEADING_SIZE`, `MONO`, `SERIF`, `Frame`, `Opts`, `Setter`, `Para`, `layout`, `para`, `place`, `stack` |
| card_one.rs | 140 | `one` |
| card_table.rs | 94 | `roman`, `marker`, `table` |
| card_marks.rs | 90 | `Palette`, `LIGHT`, `DARK`, `PAPER`, `ink`, `mark`, `alert`, `hex`, `check_colours`, `bar_colours` |

No function stays over 80 lines.


<a id="engine-text-lib"></a>

## *engine/crates/text/src/lib.rs* (432 lines) → *engine/crates/text/src/lib.rs*

Pattern: Rust modules by topic; the plain types leave, Text and its methods stay.

lib.rs keeps Text and its impl blocks and adds `mod types; pub use types::*;` so every public name stays. map.md named lay.rs; moving the types alone is enough to fall under 400, and `lay` (about 120 lines) is cut in phase 2 in place.

| new file | lines | what goes there |
|---|---|---|
| lib.rs | 326 | `atlas`, `card`, `markdown`, `math`, `Text`, `CardKey`, `impl Text`, `impl Text`, `style_key`, `impl Text`, `tests`, `is_markdown` |
| types.rs | 96 | `FALLBACK`, `EXT`, `Span`, `impl Span`, `Align`, `Font`, `impl Font`, `GlyphRun`, `Rule`, `Laid`, `BlobData`, `impl AsRef` |

No function stays over 80 lines.


<a id="engine-web-bind"></a>

## *engine/crates/web/src/bind.rs* (1137 lines) → *engine/crates/web/src/bind.rs*

Pattern: Rust modules by topic; the `#[wasm_bindgen] impl PageEngine` is split into several `#[wasm_bindgen] impl PageEngine` blocks, which wasm-bindgen allows, so the JavaScript class keeps every method.

bind.rs keeps start, err, GpuHandle and its impl, the copy_in helpers, reader, typesetter, parse_edits, previews and the PageEngine struct, and adds `mod bind_page_doc; mod bind_page_pictures; mod bind_page_view; mod bind_worker; mod bind_text;` with `pub use bind_worker::WorkerEngine; pub use bind_text::{TextMeasure, Fixtures};`. The JavaScript names wasm-bindgen exports do not change, so `pkg/stage_web.js` and the canvas's imports stay as they are.

| new file | lines | what goes there |
|---|---|---|
| bind.rs | 202 | `start`, `err`, `GpuHandle`, `impl GpuHandle`, `open`, `open_stage`, `copy_in`, `copy_in_keep`, `copy_in_as`, `reader`, `typesetter`, `icon_shape`, `parse_edits`, `previews`, `view_state`, `writer_of`, `ids`, `open_canvas`, `open_offscreen`, `key`, `PageEngine` |
| bind_page_doc.rs | 191 | `new`, `set_gpu`, `add_font`, `lay_out`, `apply_edits`, `set_dark`, `set_document`, `apply`, `undo`, `redo`, `generation`, `text`, `new_id`, `pick`, `within`, `placed`, `roots`, `extent`, `box_of`, `set_markdown_reader`, `set_math`, `put_icon`, `layout`, `layout_changes`, `pick_all`, `cards`, `font_needs`, `font_needs_changed`, `measure` |
| bind_page_pictures.rs | 182 | `put_tile`, `put_tile_pixels`, `put_picture`, `free_dropped`, `fade_pictures`, `compressed_pictures`, `put_compressed_picture`, `shrink_picture`, `lay_out_pictures`, `wanted_pictures`, `has_wanted`, `pictured`, `forget_picture`, `forget_tiles`, `evict`, `shown_scale`, `show_wanted`, `tile_count` |
| bind_page_view.rs | 173 | `set_preview`, `set_view`, `set_cards`, `set_live`, `set_overlay`, `carry`, `card_marks`, `carrying`, `lift`, `landed`, `set_ink`, `frame`, `last_meshes`, `warm`, `show_lifted`, `frame_lifted`, `lost` |
| bind_worker.rs | 249 | `wasm_module`, `WorkerEngine`, `READ_TILE`, `READ_STRIDE`, `impl WorkerEngine`, `scale_for` |
| bind_text.rs | 135 | `TextMeasure`, `impl TextMeasure`, `measure_words`, `impl TextMeasure`, `route_arrow`, `Fixtures`, `impl Fixtures` |

No function stays over 80 lines.


<a id="engine-web-engine"></a>

## *engine/crates/web/src/engine.rs* (2485 lines) → *engine/crates/web/src/engine.rs*

Pattern: Rust modules by topic; `impl Page` is split across modules as several `impl Page` blocks in one crate, the struct and its fields stay in engine.rs.

engine.rs keeps Camera, MIN_TILES, Page, SentRoot, `Page::new` and the tests, and gains `mod page_edits; mod page_layout; mod page_frame; mod page_preview; mod pictures; mod worker;` with `pub use pictures::Pictures; pub use worker::Worker;`, so `crate::engine::{Page, Worker, Pictures, Camera}` stay the same names. Fields of Page that the new modules read become `pub(crate)`. `Page::frame` (233 lines) and `reroute_after` (110) are long methods; Rust functions are not gated, but each is cut at its phases in phase 2 (frame: tiles, cards, overlays; reroute_after: find, route, write). worker.rs is at 370: if it grows, its painting methods (paint, ink_areas, invalidate, discard_stale, next: 171 lines) go to worker_paint.rs as a second `impl Worker`.

| new file | lines | what goes there |
|---|---|---|
| engine.rs | 112 | `Camera`, `MIN_TILES`, `Page`, `SentRoot`, `tests`, `new` |
| page_edits.rs | 178 | `apply`, `undo`, `redo`, `apply_edits`, `boxes`, `reroute_after`, `set_document`, `set_dark` |
| page_layout.rs | 288 | `add_font`, `hold_font`, `lay_out`, `layout_json`, `layout_changes`, `root_json`, `card_json`, `pick_all`, `cards_json`, `font_needs`, `font_needs_changed`, `root_font_needs`, `pick`, `within`, `card_radii`, `carried_frame`, `cards` |
| page_frame.rs | 293 | `draw_at`, `shown_scale`, `show_wanted`, `tile_texture`, `frame` |
| page_preview.rs | 141 | `set_overlay`, `lift`, `preview`, `bend`, `unpreview_fields`, `unpreview`, `landed` |
| pictures.rs | 128 | `Pictures`, `impl Pictures`, `PICTURE_FADE_MS`, `picture`, `picture_unlaid`, `fade_pictures`, `forget_picture`, `lay_out_pictures`, `new_texture`, `forget_tiles`, `evict` |
| worker.rs | 370 | `Worker`, `impl Worker`, `TILE_SIZE`, `copy_extent` |

No function stays over 80 lines.


<a id="pen-diff"></a>

## *pen/diff.ts* (301 lines) → *pen/diff.ts*

Pattern: functions only: the file stays whole, under 400 lines; each function over 80 lines is cut into named helpers in the same file, at the lines below.

| new file | lines | what goes there |
|---|---|---|
| diff.ts | 301 | `PenEdit`, `Entry`, `index`, `same`, `fieldsOf`, `diff`, `applyEdits`, `editDocument` |

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `diff` (85 lines, in diff.ts): L76 `const visit = (list: readonly PenNode[], parent: string | nu`
- `editDocument` (86 lines, in diff.ts): L265 `for (const edit of edits) {`

<a id="pen-geometry"></a>

## *pen/geometry.ts* (266 lines) → *pen/geometry.ts*

Pattern: functions only: the file stays whole, under 400 lines; each function over 80 lines is cut into named helpers in the same file, at the lines below.

| new file | lines | what goes there |
|---|---|---|
| geometry.ts | 266 | `Rect`, `COMMAND`, `tokens`, `ARITY`, `pathBounds`, `cubicRange`, `quadRange`, `arcBounds` |

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `pathBounds` (117 lines, in geometry.ts): L60 `while (i < list.length) {`; L147 `if (!Number.isFinite(minX)) return undefined;`

<a id="pen-html"></a>

## *pen/html.ts* (705 lines) → *pen/html.ts*

Pattern: pure logic, split by topic; the Writer class keeps its state and its walk, and the methods that leave it become functions given the writer.

*html.ts* keeps `toHtml`, the options and the Writer's walk (element, place, layer, frame, sizing); `toHtml` stays the one export the entry re-exports, so no importer changes.

| new file | lines | what goes there |
|---|---|---|
| html.ts | 300 | `HtmlOptions`, `toHtml`, `BASE`, `rootsOf`, `r2`, `px`, `DEFAULT_INK`, `NOTE_PAPER`, `Sizing`, `Layer`, `layoutOf`, `Constructor@166`, `literal`, `box`, `length`, `element`, `place`, `sizing`, `frame`, `layer`, `browser`, `attr` |
| html-paint.ts | 166 | `conic`, `rgbaText`, `gradients`, `variables`, `themeOf`, `colour`, `themeVars`, `paint`, `radius`, `blurRadius`, `shadows`, `svgPaint`, `ink` |
| html-svg.ts | 136 | `HtmlIcon`, `iconsIn`, `iconOf`, `shape`, `outline`, `svgShape`, `icon` |
| html-text.ts | 84 | `escapeText`, `escapeAttr`, `FONT_CDN`, `TEXTY`, `families`, `fontFaces`, `textSizes`, `font`, `text`, `note` |
| html-tailwind.ts | 51 | `cssName`, `Decl`, `arbitrary`, `simple`, `tailwindClass`, `tailwind` |

No function stays over 80 lines.


<a id="pen-layout"></a>

## *pen/layout.ts* (419 lines) → *pen/layout.ts*

Pattern: pure logic, split by topic; `layout` (217 lines) is cut into its steps.

map.md named *layout-frame.ts* for frameContent; frameContent is a function inside `layout`, so it leaves at the cuts below, into *layout-frame.ts*, beside the other pieces of `layout`.

| new file | lines | what goes there |
|---|---|---|
| layout.ts | 292 | `Frame`, `Placed`, `Sizing`, `sizing`, `isFlowFrame`, `layoutOf`, `visible`, `layout`, `defaultSizing` |
| layout-kinds.ts | 73 | `MARKDOWN`, `isMarkdown`, `isMarkdownText`, `CARD`, `OLD_CARD`, `isCard`, `MEDIA`, `MediaItem`, `mediaOf` |
| layout-text.ts | 71 | `MeasureText`, `TextStyle`, `DEFAULT_FONT`, `DEFAULT_FONT_SIZE`, `NOTE_PAD`, `NOTE_WIDTH`, `estimateText`, `textStyleOf`, `TEXTY` |

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `layout` (212 lines, in layout.ts): L244 `const textSize = (node: PenNode, t: ThemeState, forcedW?: nu`; L271 `const frameContent = (node: PenNode, t: ThemeState, w: numbe`; L372 `const place = (node: PenNode, at: { x: number; y: number }, `
- `frameContent` (94 lines, in layout.ts): L339 `const free = Math.max(0, mainBox - contentMain);`

<a id="pen-ops"></a>

## *pen/ops.ts* (356 lines) → *pen/ops.ts*

Pattern: functions only: the file stays whole, under 400 lines; each function over 80 lines is cut into named helpers in the same file, at the lines below.

| new file | lines | what goes there |
|---|---|---|
| ops.ts | 355 | `Op`, `OpResult`, `ApplyOptions`, `apply`, `unreadableColour`, `canonicalFills`, `one`, `located`, `childrenOf`, `clampIndex`, `isInside`, `withIds`, `freshIds`, `updateInside`, `placeBox`, `round` |

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `one` (101 lines, in ops.ts): L136 `{`

<a id="pen-outline"></a>

## *pen/outline.ts* (165 lines) → *pen/outline.ts*

Pattern: functions only: the file stays whole, under 400 lines; each function over 80 lines is cut into named helpers in the same file, at the lines below.

| new file | lines | what goes there |
|---|---|---|
| outline.ts | 167 | `outlineOf`, `r2`, `pt`, `rounded`, `arcTo`, `ellipse`, `polygon`, `COMMAND`, `ARITY`, `mapped` |

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `mapped` (81 lines, in outline.ts): L102 `while (i < list.length) {`; L163 `return out.length ? out.join(" ") : undefined;`

<a id="ui-Popover"></a>

## *ui/Popover.tsx* (306 lines) → *ui/Popover.tsx*

Pattern: functions only: the file stays whole, under 400 lines; each function over 80 lines is cut into named helpers in the same file, at the lines below.

| new file | lines | what goes there |
|---|---|---|
| Popover.tsx | 307 | `Placement`, `GUTTER`, `MARGIN`, `Popover` |

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `Popover` (268 lines, in Popover.tsx): L72 `const place = () => {`; L156 `createEffect(() => {`; L256 `return (`
- `ArrowFunction@156` (99 lines, in Popover.tsx): L217 `const keys = (event: KeyboardEvent) => {`

<a id="ui-agent-marks"></a>

## *ui/agent-marks.tsx* (312 lines) → *ui/agent-marks.tsx*

Pattern: functions only: the file stays whole, under 400 lines; each function over 80 lines is cut into named helpers in the same file, at the lines below.

| new file | lines | what goes there |
|---|---|---|
| agent-marks.tsx | 321 | `INK`, `CLAUDE_PATH`, `CLAUDE_INK`, `PI_P`, `PI_DOT`, `PI_INK`, `OPENCODE_RING`, `OPENCODE_BLOCK`, `OPENCODE_INK`, `ANTIGRAVITY_ARCH`, `ANTIGRAVITY_INK`, `ARCH_CENTRELINE`, `FRAMES`, `FRAME_MS`, `GLYPH_INK`, `TILES`, `TILE_INK`, `AgentMark`, `STILL_INK`, `opencodeMark`, `Still` |

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `AgentMark` (118 lines, in agent-marks.tsx): L182 `return (`

<a id="ui-float-float-math"></a>

## *ui/float/float-math.ts* (403 lines) → *ui/float/float-math.ts*

Pattern: pure logic, split by topic.

map.md put loadFloats with the stowed code; the saved places get a file of their own instead, so both stay small.

| new file | lines | what goes there |
|---|---|---|
| float-math.ts | 201 | `Point`, `Size`, `Box`, `Anchor`, `ANCHORS`, `clamp`, `snapHome`, `room`, `Pin`, `toFraction`, `verticalShare`, `ExportDeclaration@189`, `fling`, `settle`, `clearUpward`, `avoid`, `within`, `glideMs` |
| stowed.ts | 107 | `stowsRight`, `Side`, `stowsLeft`, `stowSide`, `stowedAt`, `stowY`, `STOWED_KEY`, `Stowed`, `loadStowed`, `saveStowed` |
| saved.ts | 102 | `Saved`, `FLOATS_KEY`, `fromSaved`, `fromAnchor`, `isSaved`, `defaultStorage`, `loadFloats`, `saveFloat` |

No function stays over 80 lines.


<a id="ui-float-float"></a>

## *ui/float/float.ts* (586 lines) → *ui/float/float.ts*

Pattern: part with no markup of its own: `makeFloat` keeps its state; dragging, the tab and placing leave it as functions given a `ctx`.

map.md's drag and place, plus *tab.ts* for the pull-out tab and *options.ts* for the 81-line options type.

| new file | lines | what goes there |
|---|---|---|
| float.ts | 100 | `{ key, handle, ignore, home, bounds, size, apply, onChange, storage }`, `pin`, `disabled`, `current`, `drag`, `stowed`, `onIgnored`, `onResize`, `ExpressionStatement@541`, `ExpressionStatement@542`, `IfStatement@543`, `observer`, `TryStatement@548`, `ExpressionStatement@558`, `ReturnStatement@560` |
| drag.ts | 179 | `DRAG_THRESHOLD`, `SAMPLES`, `following`, `follow`, `onWindowMove`, `onWindowUp`, `onWindowBlur`, `listen`, `endDrag`, `onPointerDown`, `onPointerMove`, `onDoubleClick`, `swallowClick` |
| tab.ts | 155 | `TAB_SAFE_ZONE`, `PULL_OUT`, `tabWidth`, `tabDrag`, `onTabDown`, `onTabWindowMove`, `onTabWindowUp`, `onTabBlur`, `listenTab`, `onTabMove`, `onTabUp` |
| place.ts | 179 | `place`, `clear`, `settling`, `cancelSettle`, `settle`, `remember`, `restore`, `unstow`, `sendHome`, `placeAt` |
| options.ts | 112 | `FloatOptions` |

The scope `makeFloat` keeps 54 lines of its own; the parts that leave it take its shared state as one `ctx` argument.

No function stays over 80 lines.


<a id="ui-scribble"></a>

## *ui/scribble.tsx* (206 lines) → *ui/scribble.tsx*

Pattern: functions only: the file stays whole, under 400 lines; each function over 80 lines is cut into named helpers in the same file, at the lines below.

| new file | lines | what goes there |
|---|---|---|
| scribble.tsx | 211 | `KEY`, `[pencil, setPencil]`, `watching`, `watchPencil`, `ExportDeclaration@25`, `CATCH`, `isScribbleCatch`, `wordsOf`, `appendTo`, `ScribbleCatch` |

Functions still over 80 lines, and where each is cut (line numbers in today's file):

- `ScribbleCatch` (143 lines, in scribble.tsx): L137 `return (`
