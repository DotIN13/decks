# Step 4a-canvas: canvas/: packages/canvas moved to the top, src/ flattened, nothing regrouped, the name @decks/canvas kept

Dry run on 111525a5. Nothing was moved.

- files moved by git mv: 195
- files taken out of git (moved on disk): 0
- files edited or created: 15
- import lines rewritten: 365
- warnings: 0

## Moved

- packages/canvas/package.json -> canvas/package.json
- packages/canvas/scripts/build-css.mjs -> canvas/scripts/build-css.mjs
- packages/canvas/src/camera/agent-view.test.ts -> canvas/camera/agent-view.test.ts
- packages/canvas/src/camera/agent-view.ts -> canvas/camera/agent-view.ts
- packages/canvas/src/camera/agent-views.test.ts -> canvas/camera/agent-views.test.ts
- packages/canvas/src/camera/agent-views.ts -> canvas/camera/agent-views.ts
- packages/canvas/src/camera/camera.test.ts -> canvas/camera/camera.test.ts
- packages/canvas/src/camera/camera.ts -> canvas/camera/camera.ts
- packages/canvas/src/camera/controller.ts -> canvas/camera/controller.ts
- packages/canvas/src/camera/coords.ts -> canvas/camera/coords.ts
- packages/canvas/src/camera/glide.test.ts -> canvas/camera/glide.test.ts
- packages/canvas/src/camera/glide.ts -> canvas/camera/glide.ts
- packages/canvas/src/camera/insets.ts -> canvas/camera/insets.ts
- packages/canvas/src/camera/land.test.ts -> canvas/camera/land.test.ts
- packages/canvas/src/camera/land.ts -> canvas/camera/land.ts
- packages/canvas/src/camera/landing.test.ts -> canvas/camera/landing.test.ts
- packages/canvas/src/camera/landing.ts -> canvas/camera/landing.ts
- packages/canvas/src/camera/scroll-area.test.ts -> canvas/camera/scroll-area.test.ts
- packages/canvas/src/camera/scroll-area.ts -> canvas/camera/scroll-area.ts
- packages/canvas/src/camera/spring.ts -> canvas/camera/spring.ts
- packages/canvas/src/camera/stage-ops.test.ts -> canvas/camera/stage-ops.test.ts
- packages/canvas/src/camera/stage-ops.ts -> canvas/camera/stage-ops.ts
- packages/canvas/src/camera/touch.test.ts -> canvas/camera/touch.test.ts
- packages/canvas/src/camera/touch.ts -> canvas/camera/touch.ts
- packages/canvas/src/camera/touched.ts -> canvas/camera/touched.ts
- packages/canvas/src/camera/zoom-keys.test.ts -> canvas/camera/zoom-keys.test.ts
- packages/canvas/src/camera/zoom-keys.ts -> canvas/camera/zoom-keys.ts
- packages/canvas/src/cards/CardEditor.tsx -> canvas/cards/CardEditor.tsx
- packages/canvas/src/debug.ts -> canvas/debug.ts
- packages/canvas/src/edit/core/arrows.test.ts -> canvas/edit/core/arrows.test.ts
- packages/canvas/src/edit/core/arrows.ts -> canvas/edit/core/arrows.ts
- packages/canvas/src/edit/core/dispatch.test.ts -> canvas/edit/core/dispatch.test.ts
- packages/canvas/src/edit/core/dispatch.ts -> canvas/edit/core/dispatch.ts
- packages/canvas/src/edit/core/drop.test.ts -> canvas/edit/core/drop.test.ts
- packages/canvas/src/edit/core/drop.ts -> canvas/edit/core/drop.ts
- packages/canvas/src/edit/core/fake-scene.test-helper.ts -> canvas/edit/core/fake-scene.test-helper.ts
- packages/canvas/src/edit/core/gesture.test.ts -> canvas/edit/core/gesture.test.ts
- packages/canvas/src/edit/core/gesture.ts -> canvas/edit/core/gesture.ts
- packages/canvas/src/edit/core/imports.test.ts -> canvas/edit/core/imports.test.ts
- packages/canvas/src/edit/core/insert.test.ts -> canvas/edit/core/insert.test.ts
- packages/canvas/src/edit/core/insert.ts -> canvas/edit/core/insert.ts
- packages/canvas/src/edit/core/keys.test.ts -> canvas/edit/core/keys.test.ts
- packages/canvas/src/edit/core/keys.ts -> canvas/edit/core/keys.ts
- packages/canvas/src/edit/core/model.ts -> canvas/edit/core/model.ts
- packages/canvas/src/edit/core/ops.test.ts -> canvas/edit/core/ops.test.ts
- packages/canvas/src/edit/core/ops.ts -> canvas/edit/core/ops.ts
- packages/canvas/src/edit/core/overlay-json.ts -> canvas/edit/core/overlay-json.ts
- packages/canvas/src/edit/core/overlay.test.ts -> canvas/edit/core/overlay.test.ts
- packages/canvas/src/edit/core/overlay.ts -> canvas/edit/core/overlay.ts
- packages/canvas/src/edit/core/pick.test.ts -> canvas/edit/core/pick.test.ts
- packages/canvas/src/edit/core/pick.ts -> canvas/edit/core/pick.ts
- packages/canvas/src/edit/core/resize.test.ts -> canvas/edit/core/resize.test.ts
- packages/canvas/src/edit/core/resize.ts -> canvas/edit/core/resize.ts
- packages/canvas/src/edit/core/scene.ts -> canvas/edit/core/scene.ts
- packages/canvas/src/edit/core/snapping.test.ts -> canvas/edit/core/snapping.test.ts
- packages/canvas/src/edit/core/snapping.ts -> canvas/edit/core/snapping.ts
- packages/canvas/src/edit/core/text.test.ts -> canvas/edit/core/text.test.ts
- packages/canvas/src/edit/core/text.ts -> canvas/edit/core/text.ts
- packages/canvas/src/edit/dom/OverlayLayer.tsx -> canvas/edit/dom/OverlayLayer.tsx
- packages/canvas/src/edit/dom/TextEditing.tsx -> canvas/edit/dom/TextEditing.tsx
- packages/canvas/src/edit/dom/colours.ts -> canvas/edit/dom/colours.ts
- packages/canvas/src/edit/dom/controller.ts -> canvas/edit/dom/controller.ts
- packages/canvas/src/edit/dom/effects.ts -> canvas/edit/dom/effects.ts
- packages/canvas/src/edit/dom/keys.ts -> canvas/edit/dom/keys.ts
- packages/canvas/src/edit/dom/pointer.ts -> canvas/edit/dom/pointer.ts
- packages/canvas/src/edit/dom/touch-rules.test.ts -> canvas/edit/dom/touch-rules.test.ts
- packages/canvas/src/edit/dom/touch-rules.ts -> canvas/edit/dom/touch-rules.ts
- packages/canvas/src/edit/held.ts -> canvas/edit/held.ts
- packages/canvas/src/edit/index.ts -> canvas/edit/index.ts
- packages/canvas/src/edit/ops-constants.test.ts -> canvas/edit/ops-constants.test.ts
- packages/canvas/src/edit/pen-tools.test.ts -> canvas/edit/pen-tools.test.ts
- packages/canvas/src/edit/pen-tools.ts -> canvas/edit/pen-tools.ts
- packages/canvas/src/edit/scene-ts.ts -> canvas/edit/scene-ts.ts
- packages/canvas/src/edit/snap.test.ts -> canvas/edit/snap.test.ts
- packages/canvas/src/edit/snap.ts -> canvas/edit/snap.ts
- packages/canvas/src/editor.tsx -> canvas/editor.tsx
- packages/canvas/src/frame/chrome.ts -> canvas/frame/chrome.ts
- packages/canvas/src/frame/inside/backend.ts -> canvas/frame/inside/backend.ts
- packages/canvas/src/frame/inside/boot.ts -> canvas/frame/inside/boot.ts
- packages/canvas/src/frame/inside/card-calls.ts -> canvas/frame/inside/card-calls.ts
- packages/canvas/src/frame/inside/clipboard.ts -> canvas/frame/inside/clipboard.ts
- packages/canvas/src/frame/inside/events.ts -> canvas/frame/inside/events.ts
- packages/canvas/src/frame/inside/frame.tsx -> canvas/frame/inside/frame.tsx
- packages/canvas/src/frame/inside/life.ts -> canvas/frame/inside/life.ts
- packages/canvas/src/frame/inside/line.ts -> canvas/frame/inside/line.ts
- packages/canvas/src/frame/inside/marks.test.ts -> canvas/frame/inside/marks.test.ts
- packages/canvas/src/frame/inside/marks.ts -> canvas/frame/inside/marks.ts
- packages/canvas/src/frame/inside/options.ts -> canvas/frame/inside/options.ts
- packages/canvas/src/frame/inside/presence.ts -> canvas/frame/inside/presence.ts
- packages/canvas/src/frame/inside/studio-line.ts -> canvas/frame/inside/studio-line.ts
- packages/canvas/src/frame/outside/host.tsx -> canvas/frame/outside/host.tsx
- packages/canvas/src/frame/protocol.ts -> canvas/frame/protocol.ts
- packages/canvas/src/host-pass.test.ts -> canvas/host-pass.test.ts
- packages/canvas/src/host.ts -> canvas/host.ts
- packages/canvas/src/index.ts -> canvas/index.ts
- packages/canvas/src/ink/StageInk.tsx -> canvas/ink/StageInk.tsx
- packages/canvas/src/ink/ink-keys.test.ts -> canvas/ink/ink-keys.test.ts
- packages/canvas/src/ink/ink-keys.ts -> canvas/ink/ink-keys.ts
- packages/canvas/src/ink/ink.ts -> canvas/ink/ink.ts
- packages/canvas/src/items/MediaPlayer.tsx -> canvas/items/MediaPlayer.tsx
- packages/canvas/src/items/awake.test.ts -> canvas/items/awake.test.ts
- packages/canvas/src/items/awake.ts -> canvas/items/awake.ts
- packages/canvas/src/items/card-load.test.ts -> canvas/items/card-load.test.ts
- packages/canvas/src/items/card-load.ts -> canvas/items/card-load.ts
- packages/canvas/src/items/card-reading.ts -> canvas/items/card-reading.ts
- packages/canvas/src/items/card-snapshot.test.ts -> canvas/items/card-snapshot.test.ts
- packages/canvas/src/items/card-snapshot.ts -> canvas/items/card-snapshot.ts
- packages/canvas/src/items/card-surface.tsx -> canvas/items/card-surface.tsx
- packages/canvas/src/items/card.ts -> canvas/items/card.ts
- packages/canvas/src/items/input.ts -> canvas/items/input.ts
- packages/canvas/src/items/item-slot.tsx -> canvas/items/item-slot.tsx
- packages/canvas/src/items/item-surfaces.tsx -> canvas/items/item-surfaces.tsx
- packages/canvas/src/items/missing.ts -> canvas/items/missing.ts
- packages/canvas/src/items/natural-size.ts -> canvas/items/natural-size.ts
- packages/canvas/src/items/news.test.ts -> canvas/items/news.test.ts
- packages/canvas/src/items/news.ts -> canvas/items/news.ts
- packages/canvas/src/look/font-coverage.ts -> canvas/look/font-coverage.ts
- packages/canvas/src/look/font-files.ts -> canvas/look/font-files.ts
- packages/canvas/src/look/highlight.ts -> canvas/look/highlight.ts
- packages/canvas/src/look/icon-index.test.ts -> canvas/look/icon-index.test.ts
- packages/canvas/src/look/icon-index.ts -> canvas/look/icon-index.ts
- packages/canvas/src/look/icons.ts -> canvas/look/icons.ts
- packages/canvas/src/look/look.ts -> canvas/look/look.ts
- packages/canvas/src/look/math.test.ts -> canvas/look/math.test.ts
- packages/canvas/src/look/math.ts -> canvas/look/math.ts
- packages/canvas/src/look/media-look.ts -> canvas/look/media-look.ts
- packages/canvas/src/model/bounds.test.ts -> canvas/model/bounds.test.ts
- packages/canvas/src/model/bounds.ts -> canvas/model/bounds.ts
- packages/canvas/src/model/boxes.ts -> canvas/model/boxes.ts
- packages/canvas/src/model/card-frame.test.ts -> canvas/model/card-frame.test.ts
- packages/canvas/src/model/card-frame.ts -> canvas/model/card-frame.ts
- packages/canvas/src/model/card-syntax.ts -> canvas/model/card-syntax.ts
- packages/canvas/src/model/comment-text.ts -> canvas/model/comment-text.ts
- packages/canvas/src/model/doc-index.ts -> canvas/model/doc-index.ts
- packages/canvas/src/model/drawing.test.ts -> canvas/model/drawing.test.ts
- packages/canvas/src/model/drawing.ts -> canvas/model/drawing.ts
- packages/canvas/src/model/file-drop.test.ts -> canvas/model/file-drop.test.ts
- packages/canvas/src/model/file-drop.ts -> canvas/model/file-drop.ts
- packages/canvas/src/model/file-kinds.ts -> canvas/model/file-kinds.ts
- packages/canvas/src/model/ink.test.ts -> canvas/model/ink.test.ts
- packages/canvas/src/model/ink.ts -> canvas/model/ink.ts
- packages/canvas/src/model/layers.test.ts -> canvas/model/layers.test.ts
- packages/canvas/src/model/layers.ts -> canvas/model/layers.ts
- packages/canvas/src/model/markdown.test.ts -> canvas/model/markdown.test.ts
- packages/canvas/src/model/markdown.ts -> canvas/model/markdown.ts
- packages/canvas/src/public/camera.ts -> canvas/public/camera.ts
- packages/canvas/src/public/comments.ts -> canvas/public/comments.ts
- packages/canvas/src/public/host.ts -> canvas/public/host.ts
- packages/canvas/src/public/tools.ts -> canvas/public/tools.ts
- packages/canvas/src/render/backends/detect.ts -> canvas/render/backends/detect.ts
- packages/canvas/src/render/backends/notice.ts -> canvas/render/backends/notice.ts
- packages/canvas/src/render/backends/webgl.ts -> canvas/render/backends/webgl.ts
- packages/canvas/src/render/backends/webgpu.ts -> canvas/render/backends/webgpu.ts
- packages/canvas/src/render/device.test.ts -> canvas/render/device.test.ts
- packages/canvas/src/render/device.ts -> canvas/render/device.ts
- packages/canvas/src/render/engine.ts -> canvas/render/engine.ts
- packages/canvas/src/render/measure.ts -> canvas/render/measure.ts
- packages/canvas/src/render/picture-ladder.test.ts -> canvas/render/picture-ladder.test.ts
- packages/canvas/src/render/picture-ladder.ts -> canvas/render/picture-ladder.ts
- packages/canvas/src/render/reader.ts -> canvas/render/reader.ts
- packages/canvas/src/render/recovery.test.ts -> canvas/render/recovery.test.ts
- packages/canvas/src/render/recovery.ts -> canvas/render/recovery.ts
- packages/canvas/src/render/render.worker.ts -> canvas/render/render.worker.ts
- packages/canvas/src/render/spatial.test.ts -> canvas/render/spatial.test.ts
- packages/canvas/src/render/spatial.ts -> canvas/render/spatial.ts
- packages/canvas/src/render/types.ts -> canvas/render/types.ts
- packages/canvas/src/stage/Stage.tsx -> canvas/stage/Stage.tsx
- packages/canvas/src/stage/input.ts -> canvas/stage/input.ts
- packages/canvas/src/stage/items-layer.tsx -> canvas/stage/items-layer.tsx
- packages/canvas/src/stage/selection.tsx -> canvas/stage/selection.tsx
- packages/canvas/src/theme.ts -> canvas/theme.ts
- packages/canvas/src/types.ts -> canvas/types.ts
- packages/canvas/src/ui/AgentCursor.tsx -> canvas/ui/AgentCursor.tsx
- packages/canvas/src/ui/Callout.tsx -> canvas/ui/Callout.tsx
- packages/canvas/src/ui/ColorPicker.tsx -> canvas/ui/ColorPicker.tsx
- packages/canvas/src/ui/HoldMenu.tsx -> canvas/ui/HoldMenu.tsx
- packages/canvas/src/ui/InkBar.tsx -> canvas/ui/InkBar.tsx
- packages/canvas/src/ui/Insert.tsx -> canvas/ui/Insert.tsx
- packages/canvas/src/ui/InsertMenu.tsx -> canvas/ui/InsertMenu.tsx
- packages/canvas/src/ui/PenBar.tsx -> canvas/ui/PenBar.tsx
- packages/canvas/src/ui/Properties.tsx -> canvas/ui/Properties.tsx
- packages/canvas/src/ui/adaptive.test.ts -> canvas/ui/adaptive.test.ts
- packages/canvas/src/ui/adaptive.ts -> canvas/ui/adaptive.ts
- packages/canvas/src/ui/keycaps.test.ts -> canvas/ui/keycaps.test.ts
- packages/canvas/src/ui/keycaps.ts -> canvas/ui/keycaps.ts
- packages/canvas/src/ui/menu-place.test.ts -> canvas/ui/menu-place.test.ts
- packages/canvas/src/ui/menu-place.ts -> canvas/ui/menu-place.ts
- packages/canvas/styles/canvas.css -> canvas/styles/canvas.css
- packages/canvas/styles/host.css -> canvas/styles/host.css
- packages/canvas/styles/ink.css -> canvas/styles/ink.css
- packages/canvas/styles/marks.css -> canvas/styles/marks.css
- packages/canvas/styles/surface-hooks.json -> canvas/styles/surface-hooks.json
- packages/canvas/styles/surface-tokens.css -> canvas/styles/surface-tokens.css
- packages/canvas/styles/surface.css -> canvas/styles/surface.css
- packages/canvas/tsconfig.json -> canvas/tsconfig.json

## Lines rewritten

e2e/backends-kit.mjs:15
  - /** `packages/canvas/src/render/backends/notice.ts`, word for word. */
  + /** `canvas/render/backends/notice.ts`, word for word. */
e2e/checks/backends.mjs:2
  - * The stage draws on what a browser has (`packages/canvas/src/render/backends/`): WebGL 2 where there is no
  + * The stage draws on what a browser has (`canvas/render/backends/`): WebGL 2 where there is no
e2e/checks/edits-wait.mjs:16
  - * has them arrives (`packages/canvas/src/model/drawing.ts`), so every case asks for no frame of the old
  + * has them arrives (`canvas/model/drawing.ts`), so every case asks for no frame of the old
e2e/checks/layers-webkit.mjs:4
  - * `LAYERS` in `packages/canvas/src/render/device.ts`: measured on an iPad and in WebKit on a Mac, a zoom
  + * `LAYERS` in `canvas/render/device.ts`: measured on an iPad and in WebKit on a Mac, a zoom
e2e/checks/tile-pixels.mjs:5
  - * (`paintPixels` in `crates/web/src/bind.rs`, `pixelsFirst` in `packages/canvas/src/stage/engine.ts`),
  + * (`paintPixels` in `crates/web/src/bind.rs`, `pixelsFirst` in `canvas/stage/engine.ts`),
harness/page/styles/cascade-order.json:32
  - "packages/canvas/styles/canvas.css": 304,
  + "canvas/styles/canvas.css": 304,
harness/page/styles/cascade-order.json:33
  - "packages/canvas/styles/ink.css": 10,
  + "canvas/styles/ink.css": 10,
harness/page/styles/cascade-order.json:34
  - "packages/canvas/styles/marks.css": 25,
  + "canvas/styles/marks.css": 25,
harness/page/styles/cascade-order.json:35
  - "packages/canvas/styles/surface-tokens.css": 3
  + "canvas/styles/surface-tokens.css": 3
harness/page/styles/cascade-order.json:522
  - ["packages/canvas/styles/surface-tokens.css","@layer decks.surface ▸ :root,.decks-canvas,.stage{--canvas-accent:#3b5cf6;--canvas-accent-soft:#d7e2fc;--canvas-warn:#e7af36;--canvas-fg:#161616;--canvas-muted:#5c5c5c;--canvas-faint:#808080;--canvas-line:#0000001a;--canvas-line-strong:#00000033;--canvas-panel:#ffffff;--canvas-bg:#f5f5f5;--canvas-bg-deep:#f2f2f2;--canvas-stage:#f5f5f5;--canvas-shadow:0 1px 2px #0000000d, 0 6px 18px #0000000f;--canvas-radius:12px;--canvas-radius-thumb:5px;--canvas-radius-pill:999px;--canvas-font-sans:\"Inter\", -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif;--canvas-font-mono:\"JetBrains Mono\", ui-monospace, SFMono-Regular, Menlo, monospace;--canvas-type-label:11.5px;--canvas-type-ui:12px;--canvas-type-copy:12.5px;--canvas-type-body:13px;--canvas-type-name:14px;--canvas-type-title:15px;--canvas-z-float:30}"],
  + ["canvas/styles/surface-tokens.css","@layer decks.surface ▸ :root,.decks-canvas,.stage{--canvas-accent:#3b5cf6;--canvas-accent-soft:#d7e2fc;--canvas-warn:#e7af36;--canvas-fg:#161616;--canvas-muted:#5c5c5c;--canvas-faint:#808080;--canvas-line:#0000001a;--canvas-line-strong:#00000033;--canvas-panel:#ffffff;--canvas-bg:#f5f5f5;--canvas-bg-deep:#f2f2f2;--canvas-stage:#f5f5f5;--canvas-shadow:0 1px 2px #0000000d, 0 6px 18px #0000000f;--canvas-radius:12px;--canvas-radius-thumb:5px;--canvas-radius-pill:999px;--canvas-font-sans:\"Inter\", -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif;--canvas-font-mono:\"JetBrains Mono\", ui-monospace, SFMono-Regular, Menlo, monospace;--canvas-type-label:11.5px;--canvas-type-ui:12px;--canvas-type-copy:12.5px;--canvas-type-body:13px;--canvas-type-name:14px;--canvas-type-title:15px;--canvas-z-float:30}"],
harness/page/styles/cascade-order.json:523
  - ["packages/canvas/styles/surface-tokens.css","@layer decks.surface ▸ [data-color-scheme=\"dark\"],[data-color-scheme=\"dark\"] .decks-canvas,[data-color-scheme=\"dark\"] .stage{--canvas-fg:#fafafa;--canvas-muted:#aeaeae;--canvas-line:#ffffff1f;--canvas-line-strong:#ffffff3d;--canvas-panel:#242424;--canvas-bg:#1e1e1e;--canvas-bg-deep:#080808;--canvas-stage:#1e1e1e;--canvas-shadow:0 1px 2px #00000066, 0 6px 18px #0000004d}"],
  + ["canvas/styles/surface-tokens.css","@layer decks.surface ▸ [data-color-scheme=\"dark\"],[data-color-scheme=\"dark\"] .decks-canvas,[data-color-scheme=\"dark\"] .stage{--canvas-fg:#fafafa;--canvas-muted:#aeaeae;--canvas-line:#ffffff1f;--canvas-line-strong:#ffffff3d;--canvas-panel:#242424;--canvas-bg:#1e1e1e;--canvas-bg-deep:#080808;--canvas-stage:#1e1e1e;--canvas-shadow:0 1px 2px #00000066, 0 6px 18px #0000004d}"],
harness/page/styles/cascade-order.json:524
  - ["packages/canvas/styles/surface-tokens.css","@layer decks.surface ▸ @media (pointer: coarse) ▸ :root,.decks-canvas,.stage{--canvas-radius:26px}"],
  + ["canvas/styles/surface-tokens.css","@layer decks.surface ▸ @media (pointer: coarse) ▸ :root,.decks-canvas,.stage{--canvas-radius:26px}"],
harness/page/styles/cascade-order.json:525
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .stage{position:absolute;inset:0;overflow:scroll;scrollbar-width:none;overscroll-behavior:none;background:var(--canvas-stage);touch-action:pan-x pan-y}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .stage{position:absolute;inset:0;overflow:scroll;scrollbar-width:none;overscroll-behavior:none;background:var(--canvas-stage);touch-action:pan-x pan-y}"],
harness/page/styles/cascade-order.json:526
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .stage::-webkit-scrollbar{display:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .stage::-webkit-scrollbar{display:none}"],
harness/page/styles/cascade-order.json:527
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .stage-content{position:relative;width:200000px;height:200000px;pointer-events:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .stage-content{position:relative;width:200000px;height:200000px;pointer-events:none}"],
harness/page/styles/cascade-order.json:528
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .stage-content > .world{pointer-events:auto}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .stage-content > .world{pointer-events:auto}"],
harness/page/styles/cascade-order.json:529
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .stage-fixed{position:sticky;z-index:1;top:0;left:0;pointer-events:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .stage-fixed{position:sticky;z-index:1;top:0;left:0;pointer-events:none}"],
harness/page/styles/cascade-order.json:530
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .stage-fixed > *{pointer-events:auto}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .stage-fixed > *{pointer-events:auto}"],
harness/page/styles/cascade-order.json:531
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .stage[data-panning=\"true\"]{cursor:grabbing}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .stage[data-panning=\"true\"]{cursor:grabbing}"],
harness/page/styles/cascade-order.json:532
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .stage[data-scaling=\"true\"] .card-node :is(.card-host,.document-surface){will-change:transform}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .stage[data-scaling=\"true\"] .card-node :is(.card-host,.document-surface){will-change:transform}"],
harness/page/styles/cascade-order.json:533
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .stage[data-card-pictures=\"true\"] .card-node .card-surface{visibility:hidden}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .stage[data-card-pictures=\"true\"] .card-node .card-surface{visibility:hidden}"],
harness/page/styles/cascade-order.json:534
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .stage[data-card-pictures=\"true\"] .card-node .card-host{will-change:auto}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .stage[data-card-pictures=\"true\"] .card-node .card-host{will-change:auto}"],
harness/page/styles/cascade-order.json:535
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .card-node[data-asleep] :is(.card-surface,.document-surface,.app-surface){content-visibility:hidden}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .card-node[data-asleep] :is(.card-surface,.document-surface,.app-surface){content-visibility:hidden}"],
harness/page/styles/cascade-order.json:536
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .stage[data-sliding=\"true\"] .world{will-change:transform}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .stage[data-sliding=\"true\"] .world{will-change:transform}"],
harness/page/styles/cascade-order.json:537
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world{position:absolute;top:0;left:0;transform-origin:0 0}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world{position:absolute;top:0;left:0;transform-origin:0 0}"],
harness/page/styles/cascade-order.json:538
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .stage-engine{position:absolute;top:0;left:0;pointer-events:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .stage-engine{position:absolute;top:0;left:0;pointer-events:none}"],
harness/page/styles/cascade-order.json:539
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .stage-engine-over{transform-origin:0 0}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .stage-engine-over{transform-origin:0 0}"],
harness/page/styles/cascade-order.json:540
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .stage-notice{position:absolute;z-index:var(--canvas-z-float);top:50%;left:50%;max-width:min(420px, calc(100% - 48px));padding:14px 18px;transform:translate(-50%, -50%);border:1px solid var(--canvas-line-strong);border-radius:var(--canvas-radius, 12px);background:var(--canvas-panel);box-shadow:var(--canvas-shadow);color:var(--canvas-fg);font-size:var(--canvas-type-copy);line-height:1.45;text-align:center;text-wrap:balance;pointer-events:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .stage-notice{position:absolute;z-index:var(--canvas-z-float);top:50%;left:50%;max-width:min(420px, calc(100% - 48px));padding:14px 18px;transform:translate(-50%, -50%);border:1px solid var(--canvas-line-strong);border-radius:var(--canvas-radius, 12px);background:var(--canvas-panel);box-shadow:var(--canvas-shadow);color:var(--canvas-fg);font-size:var(--canvas-type-copy);line-height:1.45;text-align:center;text-wrap:balance;pointer-events:none}"],
harness/page/styles/cascade-order.json:541
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .stage[data-engine] .card-node > .surface{background:transparent}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .stage[data-engine] .card-node > .surface{background:transparent}"],
harness/page/styles/cascade-order.json:542
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .card-node{position:absolute}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .card-node{position:absolute}"],
harness/page/styles/cascade-order.json:543
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .card-node[data-sizing=\"true\"],.card-node[data-sizing=\"true\"] > .surface,.bar-layer .chrome[data-sizing=\"true\"],.stage[data-engine-overlays=\"true\"] .world > :is(.pen-kin,.pen-selection,.pen-selection-box,.pen-hover,.pen-join,.pen-insert,.pen-slots,.pen-slot-frame,.pen-guides,.pen-measure,.pen-draft,.pen-draft-line,.pen-side){opacity:0}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .card-node[data-sizing=\"true\"],.card-node[data-sizing=\"true\"] > .surface,.bar-layer .chrome[data-sizing=\"true\"],.stage[data-engine-overlays=\"true\"] .world > :is(.pen-kin,.pen-selection,.pen-selection-box,.pen-hover,.pen-join,.pen-insert,.pen-slots,.pen-slot-frame,.pen-guides,.pen-measure,.pen-draft,.pen-draft-line,.pen-side){opacity:0}"],
harness/page/styles/cascade-order.json:544
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .stage[data-engine-overlays=\"true\"] .world > :is(.pen-handle,.pen-anchor){background:transparent !important;box-shadow:none !important;border-color:transparent !important}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .stage[data-engine-overlays=\"true\"] .world > :is(.pen-handle,.pen-anchor){background:transparent !important;box-shadow:none !important;border-color:transparent !important}"],
harness/page/styles/cascade-order.json:545
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-selection[data-sizing=\"true\"]{transition:width 280ms cubic-bezier(0.2, 0.7, 0.2, 1), height 280ms cubic-bezier(0.2, 0.7, 0.2, 1), opacity 180ms ease-out}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-selection[data-sizing=\"true\"]{transition:width 280ms cubic-bezier(0.2, 0.7, 0.2, 1), height 280ms cubic-bezier(0.2, 0.7, 0.2, 1), opacity 180ms ease-out}"],
harness/page/styles/cascade-order.json:546
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world[data-sizing=\"true\"] > .pen-handle{opacity:0}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world[data-sizing=\"true\"] > .pen-handle{opacity:0}"],
harness/page/styles/cascade-order.json:547
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .card-node > .shade{position:absolute;border-radius:var(--canvas-card-radius, 12px);inset:0;outline:1px solid var(--canvas-line);pointer-events:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .card-node > .shade{position:absolute;border-radius:var(--canvas-card-radius, 12px);inset:0;outline:1px solid var(--canvas-line);pointer-events:none}"],
harness/page/styles/cascade-order.json:548
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .card-node > .news-glow{position:absolute;inset:0;border-radius:var(--canvas-card-radius, 12px);pointer-events:none;opacity:1;transition:opacity var(--read-ms, 1500ms) ease-out}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .card-node > .news-glow{position:absolute;inset:0;border-radius:var(--canvas-card-radius, 12px);pointer-events:none;opacity:1;transition:opacity var(--read-ms, 1500ms) ease-out}"],
harness/page/styles/cascade-order.json:549
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .card-node > .news-glow::after{content:\"\";position:absolute;inset:0;border-radius:var(--canvas-card-radius, 12px);box-shadow:0 0 60px 10px color-mix(in srgb, var(--canvas-news, var(--canvas-accent)) 40%, transparent), 0 4px 18px rgb(0 0 0 / 19%);will-change:opacity;animation:news-breathe 2.6s ease-in-out infinite}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .card-node > .news-glow::after{content:\"\";position:absolute;inset:0;border-radius:var(--canvas-card-radius, 12px);box-shadow:0 0 60px 10px color-mix(in srgb, var(--canvas-news, var(--canvas-accent)) 40%, transparent), 0 4px 18px rgb(0 0 0 / 19%);will-change:opacity;animation:news-breathe 2.6s ease-in-out infinite}"],
harness/page/styles/cascade-order.json:550
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .stage[data-moving=\"true\"] .card-node > .news-glow::after{animation-play-state:paused}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .stage[data-moving=\"true\"] .card-node > .news-glow::after{animation-play-state:paused}"],
harness/page/styles/cascade-order.json:551
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .stage[data-carrying=\"true\"] .card-node > .news-glow{visibility:hidden;filter:opacity(0);transition:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .stage[data-carrying=\"true\"] .card-node > .news-glow{visibility:hidden;filter:opacity(0);transition:none}"],
harness/page/styles/cascade-order.json:552
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .stage:not([data-carrying=\"true\"]) .card-node > .news-glow{transition:opacity var(--read-ms, 1500ms) ease-out, filter 90ms ease-out}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .stage:not([data-carrying=\"true\"]) .card-node > .news-glow{transition:opacity var(--read-ms, 1500ms) ease-out, filter 90ms ease-out}"],
harness/page/styles/cascade-order.json:553
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .card-node > .news-glow[data-reading]{opacity:0}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .card-node > .news-glow[data-reading]{opacity:0}"],
harness/page/styles/cascade-order.json:554
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ @keyframes news-breathe{{0%, 100% { opacity: 0.65; } 50% { opacity: 1; }}}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ @keyframes news-breathe{{0%, 100% { opacity: 0.65; } 50% { opacity: 1; }}}"],
harness/page/styles/cascade-order.json:555
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .card-node > .surface{position:relative;overflow:hidden;border-radius:var(--canvas-card-radius, 12px);background:var(--canvas-bg)}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .card-node > .surface{position:relative;overflow:hidden;border-radius:var(--canvas-card-radius, 12px);background:var(--canvas-bg)}"],
harness/page/styles/cascade-order.json:556
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .card-node > .touch-cover{position:absolute;inset:0;z-index:3;border-radius:var(--canvas-card-radius, 12px);touch-action:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .card-node > .touch-cover{position:absolute;inset:0;z-index:3;border-radius:var(--canvas-card-radius, 12px);touch-action:none}"],
harness/page/styles/cascade-order.json:557
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .card-node[data-active] > .surface{box-shadow:inset 0 0 0 2px color-mix(in srgb, var(--canvas-accent) 60%, transparent)}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .card-node[data-active] > .surface{box-shadow:inset 0 0 0 2px color-mix(in srgb, var(--canvas-accent) 60%, transparent)}"],
harness/page/styles/cascade-order.json:558
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .card-slot{display:contents}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .card-slot{display:contents}"],
harness/page/styles/cascade-order.json:559
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .card-node[data-carried] > :is(.shade,.surface){visibility:hidden}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .card-node[data-carried] > :is(.shade,.surface){visibility:hidden}"],
harness/page/styles/cascade-order.json:560
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .card-node > .surface > .edge{position:absolute;inset:0;z-index:1;width:100%;height:100%;overflow:visible;pointer-events:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .card-node > .surface > .edge{position:absolute;inset:0;z-index:1;width:100%;height:100%;overflow:visible;pointer-events:none}"],
harness/page/styles/cascade-order.json:561
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .card-node > .surface > .edge > rect{fill:none;stroke:transparent;stroke-width:8px;vector-effect:non-scaling-stroke;pointer-events:stroke}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .card-node > .surface > .edge > rect{fill:none;stroke:transparent;stroke-width:8px;vector-effect:non-scaling-stroke;pointer-events:stroke}"],
harness/page/styles/cascade-order.json:562
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .card-node > .surface > .placeholder{position:absolute;inset:0}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .card-node > .surface > .placeholder{position:absolute;inset:0}"],
harness/page/styles/cascade-order.json:563
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .stage-fixed > .bar-layer{position:absolute;inset:0;overflow:clip;pointer-events:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .stage-fixed > .bar-layer{position:absolute;inset:0;overflow:clip;pointer-events:none}"],
harness/page/styles/cascade-order.json:564
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .stage-fixed > .bar-layer[data-hidden=\"true\"]{display:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .stage-fixed > .bar-layer[data-hidden=\"true\"]{display:none}"],
harness/page/styles/cascade-order.json:565
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .stage-fixed > .bar-layer[data-low=\"true\"] .chrome :is(.title,.file){display:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .stage-fixed > .bar-layer[data-low=\"true\"] .chrome :is(.title,.file){display:none}"],
harness/page/styles/cascade-order.json:566
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .bar-layer .chrome[data-tight] .acts{display:none !important}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .bar-layer .chrome[data-tight] .acts{display:none !important}"],
harness/page/styles/cascade-order.json:567
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .stage-fixed > .bar-layer[data-moving=\"true\"] .chrome{visibility:hidden;opacity:0;transition:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .stage-fixed > .bar-layer[data-moving=\"true\"] .chrome{visibility:hidden;opacity:0;transition:none}"],
harness/page/styles/cascade-order.json:568
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .stage-fixed > .bar-layer:not([data-moving=\"true\"]) .chrome{transition:opacity 90ms ease-out}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .stage-fixed > .bar-layer:not([data-moving=\"true\"]) .chrome{transition:opacity 90ms ease-out}"],
harness/page/styles/cascade-order.json:569
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .bar-layer .chrome{position:absolute;top:0;left:0;display:flex;overflow:hidden;align-items:center;gap:8px;height:24px;color:var(--canvas-muted);font-size:13px;cursor:grab;pointer-events:auto;user-select:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .bar-layer .chrome{position:absolute;top:0;left:0;display:flex;overflow:hidden;align-items:center;gap:8px;height:24px;color:var(--canvas-muted);font-size:13px;cursor:grab;pointer-events:auto;user-select:none}"],
harness/page/styles/cascade-order.json:570
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .bar-layer .chrome[data-dragging=\"true\"]{cursor:grabbing}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .bar-layer .chrome[data-dragging=\"true\"]{cursor:grabbing}"],
harness/page/styles/cascade-order.json:571
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .bar-layer .chrome .title{overflow:hidden;line-height:20px;font-weight:600;text-overflow:ellipsis;white-space:nowrap}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .bar-layer .chrome .title{overflow:hidden;line-height:20px;font-weight:600;text-overflow:ellipsis;white-space:nowrap}"],
harness/page/styles/cascade-order.json:572
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .bar-layer .chrome[data-selected] .title{color:var(--canvas-fg)}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .bar-layer .chrome[data-selected] .title{color:var(--canvas-fg)}"],
harness/page/styles/cascade-order.json:573
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .bar-layer .chrome .file{overflow:hidden;min-width:0;flex-shrink:3;color:var(--canvas-faint);font-family:var(--canvas-font-mono);font-size:11px;line-height:20px;text-overflow:ellipsis;white-space:nowrap}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .bar-layer .chrome .file{overflow:hidden;min-width:0;flex-shrink:3;color:var(--canvas-faint);font-family:var(--canvas-font-mono);font-size:11px;line-height:20px;text-overflow:ellipsis;white-space:nowrap}"],
harness/page/styles/cascade-order.json:574
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .bar-layer .chrome .acts{display:flex;flex:none;align-self:center;align-items:center;gap:2px;margin-left:auto}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .bar-layer .chrome .acts{display:flex;flex:none;align-self:center;align-items:center;gap:2px;margin-left:auto}"],
harness/page/styles/cascade-order.json:575
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .bar-layer .chrome:not(:hover,[data-hover=\"true\"],[data-selected]) .acts{display:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .bar-layer .chrome:not(:hover,[data-hover=\"true\"],[data-selected]) .acts{display:none}"],
harness/page/styles/cascade-order.json:576
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .bar-layer .chrome .act{display:grid;width:20px;height:20px;padding:0;border:0;border-radius:5px;background:none;color:var(--canvas-muted);text-decoration:none;cursor:pointer;place-items:center}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .bar-layer .chrome .act{display:grid;width:20px;height:20px;padding:0;border:0;border-radius:5px;background:none;color:var(--canvas-muted);text-decoration:none;cursor:pointer;place-items:center}"],
harness/page/styles/cascade-order.json:577
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .bar-layer .chrome .act:hover{background:var(--canvas-line);color:var(--canvas-fg)}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .bar-layer .chrome .act:hover{background:var(--canvas-line);color:var(--canvas-fg)}"],
harness/page/styles/cascade-order.json:578
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .bar-layer .chrome .act[aria-pressed=\"true\"]{color:var(--canvas-accent)}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .bar-layer .chrome .act[aria-pressed=\"true\"]{color:var(--canvas-accent)}"],
harness/page/styles/cascade-order.json:579
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .bar-layer .chrome .act svg{width:13px;height:13px}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .bar-layer .chrome .act svg{width:13px;height:13px}"],
harness/page/styles/cascade-order.json:580
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .bar-layer .chrome .act.hide{position:relative;margin-left:7px}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .bar-layer .chrome .act.hide{position:relative;margin-left:7px}"],
harness/page/styles/cascade-order.json:581
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .bar-layer .chrome .act.hide::before{position:absolute;top:4px;left:-5px;width:1px;height:12px;background:var(--canvas-line-strong);content:\"\"}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .bar-layer .chrome .act.hide::before{position:absolute;top:4px;left:-5px;width:1px;height:12px;background:var(--canvas-line-strong);content:\"\"}"],
harness/page/styles/cascade-order.json:582
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .stage .card-edge{position:absolute;z-index:2;cursor:move;touch-action:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .stage .card-edge{position:absolute;z-index:2;cursor:move;touch-action:none}"],
harness/page/styles/cascade-order.json:583
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .file-live{position:absolute;box-sizing:border-box;overflow:hidden;pointer-events:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .file-live{position:absolute;box-sizing:border-box;overflow:hidden;pointer-events:none}"],
harness/page/styles/cascade-order.json:584
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .file-live > img{display:block;width:100%;height:100%;object-fit:contain;user-select:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .file-live > img{display:block;width:100%;height:100%;object-fit:contain;user-select:none}"],
harness/page/styles/cascade-order.json:585
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .stage-sheet{position:absolute;top:0;left:0;z-index:1;transform-origin:0 0;pointer-events:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .stage-sheet{position:absolute;top:0;left:0;z-index:1;transform-origin:0 0;pointer-events:none}"],
harness/page/styles/cascade-order.json:586
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .card-slot > .card-node > .agent-cursor{z-index:2}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .card-slot > .card-node > .agent-cursor{z-index:2}"],
harness/page/styles/cascade-order.json:587
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-hits{position:absolute;top:0;left:0;z-index:1;overflow:visible;pointer-events:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-hits{position:absolute;top:0;left:0;z-index:1;overflow:visible;pointer-events:none}"],
harness/page/styles/cascade-order.json:588
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-hits > .pen-hit{pointer-events:all}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-hits > .pen-hit{pointer-events:all}"],
harness/page/styles/cascade-order.json:589
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > :is(.pen-selection,.pen-selection-box,.pen-size,.pen-kin,.pen-measure,.pen-measure-tag,.pen-hover,.pen-join,.pen-insert,.pen-slots,.pen-slot-frame,.pen-guides,.pen-handle,.pen-text,.pen-draft,.pen-draft-line){z-index:3}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > :is(.pen-selection,.pen-selection-box,.pen-size,.pen-kin,.pen-measure,.pen-measure-tag,.pen-hover,.pen-join,.pen-insert,.pen-slots,.pen-slot-frame,.pen-guides,.pen-handle,.pen-text,.pen-draft,.pen-draft-line){z-index:3}"],
harness/page/styles/cascade-order.json:590
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-kin{position:absolute;border-radius:4px;pointer-events:none;outline:1px solid var(--canvas-accent);outline-offset:0;opacity:0.45}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-kin{position:absolute;border-radius:4px;pointer-events:none;outline:1px solid var(--canvas-accent);outline-offset:0;opacity:0.45}"],
harness/page/styles/cascade-order.json:591
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-kin[data-kin=\"child\"]{outline-style:dashed;opacity:0.55}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-kin[data-kin=\"child\"]{outline-style:dashed;opacity:0.55}"],
harness/page/styles/cascade-order.json:592
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-kin[data-round=\"true\"]{border-radius:var(--canvas-card-radius, 12px)}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-kin[data-round=\"true\"]{border-radius:var(--canvas-card-radius, 12px)}"],
harness/page/styles/cascade-order.json:593
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-selection-box{position:absolute;border-radius:4px;pointer-events:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-selection-box{position:absolute;border-radius:4px;pointer-events:none}"],
harness/page/styles/cascade-order.json:594
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-size{position:absolute;transform-origin:0 0;padding:2px 6px;border-radius:4px;background:var(--canvas-accent);color:#fff;font-size:12px;font-weight:500;line-height:16px;white-space:nowrap;font-variant-numeric:tabular-nums;pointer-events:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-size{position:absolute;transform-origin:0 0;padding:2px 6px;border-radius:4px;background:var(--canvas-accent);color:#fff;font-size:12px;font-weight:500;line-height:16px;white-space:nowrap;font-variant-numeric:tabular-nums;pointer-events:none}"],
harness/page/styles/cascade-order.json:595
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > :is(.pen-hover,.pen-join){position:absolute;border-radius:4px;pointer-events:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > :is(.pen-hover,.pen-join){position:absolute;border-radius:4px;pointer-events:none}"],
harness/page/styles/cascade-order.json:596
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-join{background:color-mix(in srgb, var(--canvas-accent) 10%, transparent)}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-join{background:color-mix(in srgb, var(--canvas-accent) 10%, transparent)}"],
harness/page/styles/cascade-order.json:597
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-grip{position:absolute;z-index:3;width:16px;height:24px;transform-origin:0 0;display:flex;align-items:center;justify-content:center;color:var(--canvas-faint);border-radius:4px;cursor:grab;touch-action:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-grip{position:absolute;z-index:3;width:16px;height:24px;transform-origin:0 0;display:flex;align-items:center;justify-content:center;color:var(--canvas-faint);border-radius:4px;cursor:grab;touch-action:none}"],
harness/page/styles/cascade-order.json:598
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-grip:hover{color:var(--canvas-fg);background:var(--canvas-line)}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-grip:hover{color:var(--canvas-fg);background:var(--canvas-line)}"],
harness/page/styles/cascade-order.json:599
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-grip:active{cursor:grabbing}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-grip:active{cursor:grabbing}"],
harness/page/styles/cascade-order.json:600
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-grip[data-hidden]{visibility:hidden}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-grip[data-hidden]{visibility:hidden}"],
harness/page/styles/cascade-order.json:601
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-grip svg{stroke-width:1.75;flex:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-grip svg{stroke-width:1.75;flex:none}"],
harness/page/styles/cascade-order.json:602
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-insert{position:absolute;border-radius:999px;background:var(--canvas-accent);pointer-events:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-insert{position:absolute;border-radius:999px;background:var(--canvas-accent);pointer-events:none}"],
harness/page/styles/cascade-order.json:603
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-slots{position:absolute;top:0;left:0;overflow:visible;pointer-events:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-slots{position:absolute;top:0;left:0;overflow:visible;pointer-events:none}"],
harness/page/styles/cascade-order.json:604
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-slots line{stroke:var(--canvas-accent);stroke-linecap:round;opacity:0.7}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-slots line{stroke:var(--canvas-accent);stroke-linecap:round;opacity:0.7}"],
harness/page/styles/cascade-order.json:605
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-slot-frame{position:absolute;border-radius:4px;outline:1.5px dashed var(--canvas-accent);opacity:0.6;pointer-events:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-slot-frame{position:absolute;border-radius:4px;outline:1.5px dashed var(--canvas-accent);opacity:0.6;pointer-events:none}"],
harness/page/styles/cascade-order.json:606
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > :is(.pen-hover,.pen-selection):is([data-page=\"true\"],[data-round=\"true\"]){border-radius:var(--canvas-card-radius, 12px)}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > :is(.pen-hover,.pen-selection):is([data-page=\"true\"],[data-round=\"true\"]){border-radius:var(--canvas-card-radius, 12px)}"],
harness/page/styles/cascade-order.json:607
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-guides{position:absolute;top:0;left:0;overflow:visible;pointer-events:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-guides{position:absolute;top:0;left:0;overflow:visible;pointer-events:none}"],
harness/page/styles/cascade-order.json:608
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-guides :is(line,path){stroke:#f24e1e}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-guides :is(line,path){stroke:#f24e1e}"],
harness/page/styles/cascade-order.json:609
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-measure{position:absolute;top:0;left:0;overflow:visible;pointer-events:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-measure{position:absolute;top:0;left:0;overflow:visible;pointer-events:none}"],
harness/page/styles/cascade-order.json:610
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-measure :is(line,rect){stroke:#f24e1e}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-measure :is(line,rect){stroke:#f24e1e}"],
harness/page/styles/cascade-order.json:611
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-measure-tag{position:absolute;transform-origin:0 0;padding:1px 5px;border-radius:3px;background:#f24e1e;color:#fff;font-size:12px;font-weight:500;line-height:16px;white-space:nowrap;font-variant-numeric:tabular-nums;pointer-events:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-measure-tag{position:absolute;transform-origin:0 0;padding:1px 5px;border-radius:3px;background:#f24e1e;color:#fff;font-size:12px;font-weight:500;line-height:16px;white-space:nowrap;font-variant-numeric:tabular-nums;pointer-events:none}"],
harness/page/styles/cascade-order.json:612
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-selection{position:absolute;border-radius:4px;pointer-events:none;animation:pen-select-in 120ms ease-out}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-selection{position:absolute;border-radius:4px;pointer-events:none;animation:pen-select-in 120ms ease-out}"],
harness/page/styles/cascade-order.json:613
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ @keyframes pen-select-in{{from { opacity: 0; }}}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ @keyframes pen-select-in{{from { opacity: 0; }}}"],
harness/page/styles/cascade-order.json:614
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-handle{position:absolute;box-sizing:border-box;border:0;border-radius:2px;background:var(--canvas-panel);box-shadow:inset 0 0 0 1.5px var(--canvas-accent);touch-action:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-handle{position:absolute;box-sizing:border-box;border:0;border-radius:2px;background:var(--canvas-panel);box-shadow:inset 0 0 0 1.5px var(--canvas-accent);touch-action:none}"],
harness/page/styles/cascade-order.json:615
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-handle[data-handle]:not([data-handle=\"radius\"])::before{content:\"\";position:absolute;inset:calc(-1 * var(--hit))}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-handle[data-handle]:not([data-handle=\"radius\"])::before{content:\"\";position:absolute;inset:calc(-1 * var(--hit))}"],
harness/page/styles/cascade-order.json:616
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-handle:is([data-handle=\"nw\"],[data-handle=\"se\"]){cursor:nwse-resize}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-handle:is([data-handle=\"nw\"],[data-handle=\"se\"]){cursor:nwse-resize}"],
harness/page/styles/cascade-order.json:617
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-handle:is([data-handle=\"ne\"],[data-handle=\"sw\"]){cursor:nesw-resize}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-handle:is([data-handle=\"ne\"],[data-handle=\"sw\"]){cursor:nesw-resize}"],
harness/page/styles/cascade-order.json:618
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-handle:is([data-handle=\"n\"],[data-handle=\"s\"]){cursor:ns-resize}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-handle:is([data-handle=\"n\"],[data-handle=\"s\"]){cursor:ns-resize}"],
harness/page/styles/cascade-order.json:619
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-handle:is([data-handle=\"e\"],[data-handle=\"w\"]){cursor:ew-resize}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-handle:is([data-handle=\"e\"],[data-handle=\"w\"]){cursor:ew-resize}"],
harness/page/styles/cascade-order.json:620
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-handle[data-handle=\"radius\"]{border-radius:50%;cursor:nwse-resize}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-handle[data-handle=\"radius\"]{border-radius:50%;cursor:nwse-resize}"],
harness/page/styles/cascade-order.json:621
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ @media (pointer: coarse) ▸ .world > .pen-handle{border-radius:50%}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ @media (pointer: coarse) ▸ .world > .pen-handle{border-radius:50%}"],
harness/page/styles/cascade-order.json:622
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ @media (pointer: coarse) ▸ .world > .pen-handle:is([data-handle=\"n\"],[data-handle=\"s\"],[data-handle=\"e\"],[data-handle=\"w\"]){background:transparent;box-shadow:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ @media (pointer: coarse) ▸ .world > .pen-handle:is([data-handle=\"n\"],[data-handle=\"s\"],[data-handle=\"e\"],[data-handle=\"w\"]){background:transparent;box-shadow:none}"],
harness/page/styles/cascade-order.json:623
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ @media (pointer: coarse) ▸ .world > :is(.pen-size,.pen-anchor){display:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ @media (pointer: coarse) ▸ .world > :is(.pen-size,.pen-anchor){display:none}"],
harness/page/styles/cascade-order.json:624
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player{position:absolute;overflow:hidden;transform-origin:0 0;z-index:2;pointer-events:none;font-family:var(--canvas-font-sans)}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player{position:absolute;overflow:hidden;transform-origin:0 0;z-index:2;pointer-events:none;font-family:var(--canvas-font-sans)}"],
harness/page/styles/cascade-order.json:625
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player button,.world > .pen-player [role=\"slider\"]{pointer-events:auto}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player button,.world > .pen-player [role=\"slider\"]{pointer-events:auto}"],
harness/page/styles/cascade-order.json:626
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player[data-kind=\"video\"]{background:#000}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player[data-kind=\"video\"]{background:#000}"],
harness/page/styles/cascade-order.json:627
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player > video{display:block;width:100%;height:100%;object-fit:cover}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player > video{display:block;width:100%;height:100%;object-fit:cover}"],
harness/page/styles/cascade-order.json:628
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player .pen-player-big{position:absolute;display:grid;place-items:center;padding:0;border:0;border-radius:50%;background:rgb(0 0 0 / 50%);color:#fff;cursor:pointer;opacity:0;visibility:hidden;transition:opacity 0.16s ease, visibility 0s linear 0.16s, transform 0.16s ease}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player .pen-player-big{position:absolute;display:grid;place-items:center;padding:0;border:0;border-radius:50%;background:rgb(0 0 0 / 50%);color:#fff;cursor:pointer;opacity:0;visibility:hidden;transition:opacity 0.16s ease, visibility 0s linear 0.16s, transform 0.16s ease}"],
harness/page/styles/cascade-order.json:629
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player[data-paused] .pen-player-big{opacity:1;visibility:visible;transition:opacity 0.16s ease, transform 0.16s ease}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player[data-paused] .pen-player-big{opacity:1;visibility:visible;transition:opacity 0.16s ease, transform 0.16s ease}"],
harness/page/styles/cascade-order.json:630
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player .pen-player-big:hover{transform:scale(1.06);background:rgb(0 0 0 / 62%)}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player .pen-player-big:hover{transform:scale(1.06);background:rgb(0 0 0 / 62%)}"],
harness/page/styles/cascade-order.json:631
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player .pen-player-big svg{width:62%;height:62%;fill:currentColor}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player .pen-player-big svg{width:62%;height:62%;fill:currentColor}"],
harness/page/styles/cascade-order.json:632
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player .pen-player-bar{position:absolute;left:0;right:0;bottom:0;display:flex;align-items:center;gap:calc(var(--u) * 8px);padding:calc(var(--u) * 24px) calc(var(--u) * 10px) calc(var(--u) * 8px);background:linear-gradient(to top, rgb(0 0 0 / 62%), rgb(0 0 0 / 0%));color:#fff;font-size:calc(var(--u) * 12px);font-weight:600;font-variant-numeric:tabular-nums;opacity:0;visibility:hidden;transition:opacity 0.2s ease, visibility 0s linear 0.2s}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player .pen-player-bar{position:absolute;left:0;right:0;bottom:0;display:flex;align-items:center;gap:calc(var(--u) * 8px);padding:calc(var(--u) * 24px) calc(var(--u) * 10px) calc(var(--u) * 8px);background:linear-gradient(to top, rgb(0 0 0 / 62%), rgb(0 0 0 / 0%));color:#fff;font-size:calc(var(--u) * 12px);font-weight:600;font-variant-numeric:tabular-nums;opacity:0;visibility:hidden;transition:opacity 0.2s ease, visibility 0s linear 0.2s}"],
harness/page/styles/cascade-order.json:633
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player:is([data-near],[data-paused]) .pen-player-bar{opacity:1;visibility:visible;transition:opacity 0.2s ease}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player:is([data-near],[data-paused]) .pen-player-bar{opacity:1;visibility:visible;transition:opacity 0.2s ease}"],
harness/page/styles/cascade-order.json:634
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player .pen-player-bar button{display:grid;place-items:center;flex:none;width:calc(var(--u) * 28px);height:calc(var(--u) * 28px);padding:0;border:0;border-radius:calc(var(--u) * 7px);background:transparent;color:inherit;cursor:pointer}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player .pen-player-bar button{display:grid;place-items:center;flex:none;width:calc(var(--u) * 28px);height:calc(var(--u) * 28px);padding:0;border:0;border-radius:calc(var(--u) * 7px);background:transparent;color:inherit;cursor:pointer}"],
harness/page/styles/cascade-order.json:635
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player .pen-player-bar button:hover{background:rgb(255 255 255 / 18%)}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player .pen-player-bar button:hover{background:rgb(255 255 255 / 18%)}"],
harness/page/styles/cascade-order.json:636
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player .pen-player-bar svg{width:calc(var(--u) * 18px);height:calc(var(--u) * 18px);fill:currentColor}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player .pen-player-bar svg{width:calc(var(--u) * 18px);height:calc(var(--u) * 18px);fill:currentColor}"],
harness/page/styles/cascade-order.json:637
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player .pen-player-bar svg[fill=\"none\"]{fill:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player .pen-player-bar svg[fill=\"none\"]{fill:none}"],
harness/page/styles/cascade-order.json:638
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player .pen-player-clock{flex:none;white-space:nowrap}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player .pen-player-clock{flex:none;white-space:nowrap}"],
harness/page/styles/cascade-order.json:639
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player .pen-player-track{position:relative;flex:1;height:calc(var(--u) * 16px);cursor:pointer}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player .pen-player-track{position:relative;flex:1;height:calc(var(--u) * 16px);cursor:pointer}"],
harness/page/styles/cascade-order.json:640
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player .pen-player-track::before,.world > .pen-player .pen-player-track > i{content:\"\";position:absolute;left:0;top:50%;height:calc(var(--u) * 4px);margin-top:calc(var(--u) * -2px);border-radius:99px}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player .pen-player-track::before,.world > .pen-player .pen-player-track > i{content:\"\";position:absolute;left:0;top:50%;height:calc(var(--u) * 4px);margin-top:calc(var(--u) * -2px);border-radius:99px}"],
harness/page/styles/cascade-order.json:641
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player .pen-player-track::before{right:0;background:rgb(255 255 255 / 32%)}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player .pen-player-track::before{right:0;background:rgb(255 255 255 / 32%)}"],
harness/page/styles/cascade-order.json:642
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player .pen-player-track > i{background:#fff}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player .pen-player-track > i{background:#fff}"],
harness/page/styles/cascade-order.json:643
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player[data-kind=\"audio\"] > audio{display:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player[data-kind=\"audio\"] > audio{display:none}"],
harness/page/styles/cascade-order.json:644
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player[data-kind=\"audio\"] > *{position:absolute;box-sizing:border-box}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player[data-kind=\"audio\"] > *{position:absolute;box-sizing:border-box}"],
harness/page/styles/cascade-order.json:645
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player .pen-player-disc{display:grid;place-items:center;padding:0;border:0;border-radius:50%;cursor:pointer;transition:transform 0.12s ease, filter 0.12s ease}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player .pen-player-disc{display:grid;place-items:center;padding:0;border:0;border-radius:50%;cursor:pointer;transition:transform 0.12s ease, filter 0.12s ease}"],
harness/page/styles/cascade-order.json:646
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player .pen-player-disc:hover{filter:brightness(1.08)}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player .pen-player-disc:hover{filter:brightness(1.08)}"],
harness/page/styles/cascade-order.json:647
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player .pen-player-disc:active{transform:scale(0.94)}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player .pen-player-disc:active{transform:scale(0.94)}"],
harness/page/styles/cascade-order.json:648
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player .pen-player-disc svg{width:62%;height:62%;fill:currentColor}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player .pen-player-disc svg{width:62%;height:62%;fill:currentColor}"],
harness/page/styles/cascade-order.json:649
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player .pen-player-name{overflow:hidden;font-weight:600;line-height:1.2;white-space:nowrap;text-overflow:ellipsis}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player .pen-player-name{overflow:hidden;font-weight:600;line-height:1.2;white-space:nowrap;text-overflow:ellipsis}"],
harness/page/styles/cascade-order.json:650
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player .pen-player-time{font-weight:500;line-height:1.2;white-space:nowrap;font-variant-numeric:tabular-nums}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player .pen-player-time{font-weight:500;line-height:1.2;white-space:nowrap;font-variant-numeric:tabular-nums}"],
harness/page/styles/cascade-order.json:651
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player .pen-player-wave{cursor:pointer}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player .pen-player-wave{cursor:pointer}"],
harness/page/styles/cascade-order.json:652
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player .pen-player-wave > i{position:absolute;border-radius:99px}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-player .pen-player-wave > i{position:absolute;border-radius:99px}"],
harness/page/styles/cascade-order.json:653
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-draft{position:absolute;box-sizing:border-box;border:1.5px dashed var(--canvas-accent);background:color-mix(in srgb, var(--canvas-accent) 8%, transparent);pointer-events:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-draft{position:absolute;box-sizing:border-box;border:1.5px dashed var(--canvas-accent);background:color-mix(in srgb, var(--canvas-accent) 8%, transparent);pointer-events:none}"],
harness/page/styles/cascade-order.json:654
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-draft[data-tool=\"ellipse\"]{border-radius:50%}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-draft[data-tool=\"ellipse\"]{border-radius:50%}"],
harness/page/styles/cascade-order.json:655
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-draft-line{position:absolute;pointer-events:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-draft-line{position:absolute;pointer-events:none}"],
harness/page/styles/cascade-order.json:656
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .stage[data-pen-tool]{cursor:crosshair}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .stage[data-pen-tool]{cursor:crosshair}"],
harness/page/styles/cascade-order.json:657
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .stage[data-pen-tool] .world > .card-slot > .card-node{pointer-events:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .stage[data-pen-tool] .world > .card-slot > .card-node{pointer-events:none}"],
harness/page/styles/cascade-order.json:658
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-text{position:absolute;box-sizing:border-box;margin:0;border:none;outline:none;overflow:hidden;resize:none;field-sizing:content;caret-color:var(--canvas-accent);white-space:pre-wrap;overflow-wrap:break-word}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-text{position:absolute;box-sizing:border-box;margin:0;border:none;outline:none;overflow:hidden;resize:none;field-sizing:content;caret-color:var(--canvas-accent);white-space:pre-wrap;overflow-wrap:break-word}"],
harness/page/styles/cascade-order.json:659
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-text[data-grows=\"wide\"]{white-space:pre}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-text[data-grows=\"wide\"]{white-space:pre}"],
harness/page/styles/cascade-order.json:660
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-card-editor{overflow:visible;white-space:normal;cursor:text}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-card-editor{overflow:visible;white-space:normal;cursor:text}"],
harness/page/styles/cascade-order.json:661
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-body{outline:none;white-space:pre-wrap;overflow-wrap:break-word;min-height:1.5em}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-body{outline:none;white-space:pre-wrap;overflow-wrap:break-word;min-height:1.5em}"],
harness/page/styles/cascade-order.json:662
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-body > *{margin:0 0 var(--card-size, 1em)}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-body > *{margin:0 0 var(--card-size, 1em)}"],
harness/page/styles/cascade-order.json:663
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-body > :last-child{margin-bottom:0}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-body > :last-child{margin-bottom:0}"],
harness/page/styles/cascade-order.json:664
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-body > * + :is(h1,h2,h3,h4,h5,h6){margin-top:calc(var(--card-size, 1em) * 0.25)}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-body > * + :is(h1,h2,h3,h4,h5,h6){margin-top:calc(var(--card-size, 1em) * 0.25)}"],
harness/page/styles/cascade-order.json:665
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor :is(h1,h2,h3,h4,h5,h6){font-weight:600;line-height:1.3}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor :is(h1,h2,h3,h4,h5,h6){font-weight:600;line-height:1.3}"],
harness/page/styles/cascade-order.json:666
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor h1{font-size:1.6em}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor h1{font-size:1.6em}"],
harness/page/styles/cascade-order.json:667
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor h2{font-size:1.3em}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor h2{font-size:1.3em}"],
harness/page/styles/cascade-order.json:668
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor h3{font-size:1.12em}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor h3{font-size:1.12em}"],
harness/page/styles/cascade-order.json:669
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor h4{font-size:1em}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor h4{font-size:1em}"],
harness/page/styles/cascade-order.json:670
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor h5{font-size:0.9em;color:var(--canvas-muted)}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor h5{font-size:0.9em;color:var(--canvas-muted)}"],
harness/page/styles/cascade-order.json:671
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor h6{font-size:0.85em;color:var(--canvas-muted)}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor h6{font-size:0.85em;color:var(--canvas-muted)}"],
harness/page/styles/cascade-order.json:672
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor :is(ul,ol){padding-left:1.6em;list-style:disc outside}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor :is(ul,ol){padding-left:1.6em;list-style:disc outside}"],
harness/page/styles/cascade-order.json:673
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor ol{list-style-type:decimal}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor ol{list-style-type:decimal}"],
harness/page/styles/cascade-order.json:674
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor :is(ul,ol) ul{list-style-type:circle}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor :is(ul,ol) ul{list-style-type:circle}"],
harness/page/styles/cascade-order.json:675
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor li::marker{color:var(--canvas-muted)}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor li::marker{color:var(--canvas-muted)}"],
harness/page/styles/cascade-order.json:676
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor li + li{margin-top:0.2em}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor li + li{margin-top:0.2em}"],
harness/page/styles/cascade-order.json:677
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor li > :is(ul,ol,p){margin:0}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor li > :is(ul,ol,p){margin:0}"],
harness/page/styles/cascade-order.json:678
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor ul[data-loose] > li + li,.pen-card-editor ol[data-loose] > li + li{margin-top:1em}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor ul[data-loose] > li + li,.pen-card-editor ol[data-loose] > li + li{margin-top:1em}"],
harness/page/styles/cascade-order.json:679
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor li:has(> .pce-check){list-style:none;margin-left:-1.3em}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor li:has(> .pce-check){list-style:none;margin-left:-1.3em}"],
harness/page/styles/cascade-order.json:680
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-check{display:inline-block;width:0.85em;height:0.85em;margin-right:0.45em;vertical-align:-0.08em;border:1px solid var(--canvas-line-strong);border-radius:0.21em;cursor:pointer}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-check{display:inline-block;width:0.85em;height:0.85em;margin-right:0.45em;vertical-align:-0.08em;border:1px solid var(--canvas-line-strong);border-radius:0.21em;cursor:pointer}"],
harness/page/styles/cascade-order.json:681
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-check[data-on]{background:var(--canvas-accent);border-color:var(--canvas-accent)}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-check[data-on]{background:var(--canvas-accent);border-color:var(--canvas-accent)}"],
harness/page/styles/cascade-order.json:682
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor blockquote{padding-left:calc(2px + 0.9em);border-left:2px solid var(--canvas-line-strong);color:var(--canvas-muted)}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor blockquote{padding-left:calc(2px + 0.9em);border-left:2px solid var(--canvas-line-strong);color:var(--canvas-muted)}"],
harness/page/styles/cascade-order.json:683
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor blockquote > p{margin:0}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor blockquote > p{margin:0}"],
harness/page/styles/cascade-order.json:684
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor blockquote > p + p{margin-top:1em}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor blockquote > p + p{margin-top:1em}"],
harness/page/styles/cascade-order.json:685
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor blockquote[data-callout]{--callout:#3b5cf6;padding-block:0.4em;color:inherit;border-left-color:var(--callout)}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor blockquote[data-callout]{--callout:#3b5cf6;padding-block:0.4em;color:inherit;border-left-color:var(--callout)}"],
harness/page/styles/cascade-order.json:686
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor blockquote[data-tone=\"cyan\"]{--callout:#0e8a9e}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor blockquote[data-tone=\"cyan\"]{--callout:#0e8a9e}"],
harness/page/styles/cascade-order.json:687
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor blockquote[data-tone=\"green\"]{--callout:#2a9d52}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor blockquote[data-tone=\"green\"]{--callout:#2a9d52}"],
harness/page/styles/cascade-order.json:688
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor blockquote[data-tone=\"orange\"]{--callout:#c26a12}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor blockquote[data-tone=\"orange\"]{--callout:#c26a12}"],
harness/page/styles/cascade-order.json:689
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor blockquote[data-tone=\"red\"]{--callout:#d92e3c}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor blockquote[data-tone=\"red\"]{--callout:#d92e3c}"],
harness/page/styles/cascade-order.json:690
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor blockquote[data-tone=\"purple\"]{--callout:#7c4ddb}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor blockquote[data-tone=\"purple\"]{--callout:#7c4ddb}"],
harness/page/styles/cascade-order.json:691
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor blockquote[data-tone=\"gray\"]{--callout:#6b6b6b}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor blockquote[data-tone=\"gray\"]{--callout:#6b6b6b}"],
harness/page/styles/cascade-order.json:692
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-chead{font-weight:600;color:var(--callout);margin-bottom:0.3em;cursor:text}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-chead{font-weight:600;color:var(--callout);margin-bottom:0.3em;cursor:text}"],
harness/page/styles/cascade-order.json:693
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor table.pce-table{width:100%;border-collapse:collapse}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor table.pce-table{width:100%;border-collapse:collapse}"],
harness/page/styles/cascade-order.json:694
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-table :is(th,td){padding:0.45em 0.75em;text-align:left;vertical-align:top;border-bottom:1px solid var(--canvas-line)}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-table :is(th,td){padding:0.45em 0.75em;text-align:left;vertical-align:top;border-bottom:1px solid var(--canvas-line)}"],
harness/page/styles/cascade-order.json:695
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-table :is(th,td):first-child{padding-left:0}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-table :is(th,td):first-child{padding-left:0}"],
harness/page/styles/cascade-order.json:696
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-table :is(th,td):last-child{padding-right:0}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-table :is(th,td):last-child{padding-right:0}"],
harness/page/styles/cascade-order.json:697
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-table th{font-size:0.9em;font-weight:600;color:var(--canvas-muted);border-bottom-color:var(--canvas-line-strong)}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-table th{font-size:0.9em;font-weight:600;color:var(--canvas-muted);border-bottom-color:var(--canvas-line-strong)}"],
harness/page/styles/cascade-order.json:698
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-table tr:last-child td{border-bottom:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-table tr:last-child td{border-bottom:none}"],
harness/page/styles/cascade-order.json:699
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor code{font-family:var(--canvas-font-mono);font-size:0.88em;background:var(--canvas-line);border-radius:3px;padding:0 0.2em}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor code{font-family:var(--canvas-font-mono);font-size:0.88em;background:var(--canvas-line);border-radius:3px;padding:0 0.2em}"],
harness/page/styles/cascade-order.json:700
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor pre.pce-code{font-family:var(--canvas-font-mono);font-size:0.88em;background:var(--canvas-bg-deep);border-radius:8px;padding:0.85em;white-space:pre-wrap}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor pre.pce-code{font-family:var(--canvas-font-mono);font-size:0.88em;background:var(--canvas-bg-deep);border-radius:8px;padding:0.85em;white-space:pre-wrap}"],
harness/page/styles/cascade-order.json:701
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor a[data-href]{color:var(--canvas-accent);text-decoration:underline;text-decoration-color:color-mix(in srgb, var(--canvas-accent) 40%, transparent)}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor a[data-href]{color:var(--canvas-accent);text-decoration:underline;text-decoration-color:color-mix(in srgb, var(--canvas-accent) 40%, transparent)}"],
harness/page/styles/cascade-order.json:702
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor mark{background:#facc1573;color:inherit;border-radius:2px}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor mark{background:#facc1573;color:inherit;border-radius:2px}"],
harness/page/styles/cascade-order.json:703
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor mark[data-c=\"red\"]{background:#f8717159}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor mark[data-c=\"red\"]{background:#f8717159}"],
harness/page/styles/cascade-order.json:704
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor mark[data-c=\"orange\"]{background:#fb923c59}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor mark[data-c=\"orange\"]{background:#fb923c59}"],
harness/page/styles/cascade-order.json:705
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor mark[data-c=\"green\"]{background:#4ade8059}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor mark[data-c=\"green\"]{background:#4ade8059}"],
harness/page/styles/cascade-order.json:706
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor mark[data-c=\"blue\"]{background:#38bdf859}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor mark[data-c=\"blue\"]{background:#38bdf859}"],
harness/page/styles/cascade-order.json:707
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor mark[data-c=\"purple\"]{background:#c084fc59}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor mark[data-c=\"purple\"]{background:#c084fc59}"],
harness/page/styles/cascade-order.json:708
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor [data-size=\"small\"]{font-size:0.85em}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor [data-size=\"small\"]{font-size:0.85em}"],
harness/page/styles/cascade-order.json:709
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor [data-size=\"large\"]{font-size:1.25em}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor [data-size=\"large\"]{font-size:1.25em}"],
harness/page/styles/cascade-order.json:710
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor [data-size=\"huge\"]{font-size:1.6em}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor [data-size=\"huge\"]{font-size:1.6em}"],
harness/page/styles/cascade-order.json:711
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor [data-fg=\"red\"]{color:#d92e3c}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor [data-fg=\"red\"]{color:#d92e3c}"],
harness/page/styles/cascade-order.json:712
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor [data-fg=\"orange\"]{color:#c2410c}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor [data-fg=\"orange\"]{color:#c2410c}"],
harness/page/styles/cascade-order.json:713
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor [data-fg=\"yellow\"]{color:#a16207}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor [data-fg=\"yellow\"]{color:#a16207}"],
harness/page/styles/cascade-order.json:714
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor [data-fg=\"green\"]{color:#15803d}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor [data-fg=\"green\"]{color:#15803d}"],
harness/page/styles/cascade-order.json:715
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor [data-fg=\"blue\"]{color:#2563eb}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor [data-fg=\"blue\"]{color:#2563eb}"],
harness/page/styles/cascade-order.json:716
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor [data-fg=\"purple\"]{color:#7c3aed}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor [data-fg=\"purple\"]{color:#7c3aed}"],
harness/page/styles/cascade-order.json:717
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ [data-color-scheme=\"dark\"] .pen-card-editor mark{background:#facc1547}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ [data-color-scheme=\"dark\"] .pen-card-editor mark{background:#facc1547}"],
harness/page/styles/cascade-order.json:718
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ [data-color-scheme=\"dark\"] .pen-card-editor mark[data-c=\"red\"]{background:#f871714d}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ [data-color-scheme=\"dark\"] .pen-card-editor mark[data-c=\"red\"]{background:#f871714d}"],
harness/page/styles/cascade-order.json:719
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ [data-color-scheme=\"dark\"] .pen-card-editor mark[data-c=\"orange\"]{background:#fb923c4d}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ [data-color-scheme=\"dark\"] .pen-card-editor mark[data-c=\"orange\"]{background:#fb923c4d}"],
harness/page/styles/cascade-order.json:720
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ [data-color-scheme=\"dark\"] .pen-card-editor mark[data-c=\"green\"]{background:#4ade804d}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ [data-color-scheme=\"dark\"] .pen-card-editor mark[data-c=\"green\"]{background:#4ade804d}"],
harness/page/styles/cascade-order.json:721
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ [data-color-scheme=\"dark\"] .pen-card-editor mark[data-c=\"blue\"]{background:#38bdf84d}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ [data-color-scheme=\"dark\"] .pen-card-editor mark[data-c=\"blue\"]{background:#38bdf84d}"],
harness/page/styles/cascade-order.json:722
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ [data-color-scheme=\"dark\"] .pen-card-editor mark[data-c=\"purple\"]{background:#c084fc4d}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ [data-color-scheme=\"dark\"] .pen-card-editor mark[data-c=\"purple\"]{background:#c084fc4d}"],
harness/page/styles/cascade-order.json:723
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ [data-color-scheme=\"dark\"] .pen-card-editor [data-fg=\"red\"]{color:#f06a74}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ [data-color-scheme=\"dark\"] .pen-card-editor [data-fg=\"red\"]{color:#f06a74}"],
harness/page/styles/cascade-order.json:724
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ [data-color-scheme=\"dark\"] .pen-card-editor [data-fg=\"orange\"]{color:#fb923c}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ [data-color-scheme=\"dark\"] .pen-card-editor [data-fg=\"orange\"]{color:#fb923c}"],
harness/page/styles/cascade-order.json:725
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ [data-color-scheme=\"dark\"] .pen-card-editor [data-fg=\"yellow\"]{color:#facc15}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ [data-color-scheme=\"dark\"] .pen-card-editor [data-fg=\"yellow\"]{color:#facc15}"],
harness/page/styles/cascade-order.json:726
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ [data-color-scheme=\"dark\"] .pen-card-editor [data-fg=\"green\"]{color:#4ade80}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ [data-color-scheme=\"dark\"] .pen-card-editor [data-fg=\"green\"]{color:#4ade80}"],
harness/page/styles/cascade-order.json:727
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ [data-color-scheme=\"dark\"] .pen-card-editor [data-fg=\"blue\"]{color:#60a5fa}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ [data-color-scheme=\"dark\"] .pen-card-editor [data-fg=\"blue\"]{color:#60a5fa}"],
harness/page/styles/cascade-order.json:728
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ [data-color-scheme=\"dark\"] .pen-card-editor [data-fg=\"purple\"]{color:#c084fc}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ [data-color-scheme=\"dark\"] .pen-card-editor [data-fg=\"purple\"]{color:#c084fc}"],
harness/page/styles/cascade-order.json:729
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ [data-color-scheme=\"dark\"] .pen-card-editor .pce-sug del{color:#f06a74}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ [data-color-scheme=\"dark\"] .pen-card-editor .pce-sug del{color:#f06a74}"],
harness/page/styles/cascade-order.json:730
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ [data-color-scheme=\"dark\"] .pen-card-editor .pce-sug ins{color:#7aa2ff;background:#7aa2ff26}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ [data-color-scheme=\"dark\"] .pen-card-editor .pce-sug ins{color:#7aa2ff;background:#7aa2ff26}"],
harness/page/styles/cascade-order.json:731
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-atom{color:var(--canvas-muted)}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-atom{color:var(--canvas-muted)}"],
harness/page/styles/cascade-order.json:732
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-faint{color:var(--canvas-faint);font-size:0.85em}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-faint{color:var(--canvas-faint);font-size:0.85em}"],
harness/page/styles/cascade-order.json:733
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor div.pce-raw,.pen-card-editor pre.pce-rawedit{display:block;font-family:var(--canvas-font-mono);font-size:0.8em;white-space:pre-wrap;background:var(--canvas-bg-deep);border-radius:8px;padding:0.6em 0.75em;cursor:default}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor div.pce-raw,.pen-card-editor pre.pce-rawedit{display:block;font-family:var(--canvas-font-mono);font-size:0.8em;white-space:pre-wrap;background:var(--canvas-bg-deep);border-radius:8px;padding:0.6em 0.75em;cursor:default}"],
harness/page/styles/cascade-order.json:734
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor pre.pce-rawedit{color:var(--canvas-fg);cursor:text;outline:1px dashed var(--canvas-line-strong)}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor pre.pce-rawedit{color:var(--canvas-fg);cursor:text;outline:1px dashed var(--canvas-line-strong)}"],
harness/page/styles/cascade-order.json:735
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor div.pce-held{display:block;width:fit-content;padding:0.4em 0.75em;border:1px dashed var(--canvas-line-strong);border-radius:8px;font-size:0.9em}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor div.pce-held{display:block;width:fit-content;padding:0.4em 0.75em;border:1px dashed var(--canvas-line-strong);border-radius:8px;font-size:0.9em}"],
harness/page/styles/cascade-order.json:736
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-rule{height:1px;background:var(--canvas-line);margin-block:0.5em 1em}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-rule{height:1px;background:var(--canvas-line);margin-block:0.5em 1em}"],
harness/page/styles/cascade-order.json:737
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-sug del{color:#c0262d;text-decoration:line-through}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-sug del{color:#c0262d;text-decoration:line-through}"],
harness/page/styles/cascade-order.json:738
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-sug ins{color:#2563eb;text-decoration:underline;background:#2563eb1f}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-sug ins{color:#2563eb;text-decoration:underline;background:#2563eb1f}"],
harness/page/styles/cascade-order.json:739
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-sug button{font:600 0.75em var(--canvas-font-sans, inherit);width:1.5em;height:1.5em;margin-left:0.2em;padding:0;vertical-align:0.1em;border:1px solid var(--canvas-line-strong);border-radius:999px;background:var(--canvas-panel);color:var(--canvas-fg);cursor:pointer}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-sug button{font:600 0.75em var(--canvas-font-sans, inherit);width:1.5em;height:1.5em;margin-left:0.2em;padding:0;vertical-align:0.1em;border:1px solid var(--canvas-line-strong);border-radius:999px;background:var(--canvas-panel);color:var(--canvas-fg);cursor:pointer}"],
harness/page/styles/cascade-order.json:740
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-why{font-size:0.8em;margin-left:0.15em}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-why{font-size:0.8em;margin-left:0.15em}"],
harness/page/styles/cascade-order.json:741
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-piece{display:inline-flex;align-items:center;gap:0.4em;padding:0.1em 0.45em;border:1px solid var(--canvas-line-strong);border-radius:6px;cursor:grab;user-select:none;-webkit-user-select:none;touch-action:none;font-size:0.9em;white-space:nowrap;vertical-align:baseline}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-piece{display:inline-flex;align-items:center;gap:0.4em;padding:0.1em 0.45em;border:1px solid var(--canvas-line-strong);border-radius:6px;cursor:grab;user-select:none;-webkit-user-select:none;touch-action:none;font-size:0.9em;white-space:nowrap;vertical-align:baseline}"],
harness/page/styles/cascade-order.json:742
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-piece[data-kind=\"wiki\"]{padding:0;border:none;font-size:1em;color:var(--canvas-accent);text-decoration:underline;text-decoration-color:color-mix(in srgb, var(--canvas-accent) 40%, transparent)}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-piece[data-kind=\"wiki\"]{padding:0;border:none;font-size:1em;color:var(--canvas-accent);text-decoration:underline;text-decoration-color:color-mix(in srgb, var(--canvas-accent) 40%, transparent)}"],
harness/page/styles/cascade-order.json:743
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-piece[data-kind=\"wiki\"] > .pce-ic{display:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-piece[data-kind=\"wiki\"] > .pce-ic{display:none}"],
harness/page/styles/cascade-order.json:744
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-piece.pce-block{display:flex;width:fit-content;max-width:100%;padding:0.6em 0.75em;background:var(--canvas-bg-deep);border-color:transparent;border-radius:8px}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-piece.pce-block{display:flex;width:fit-content;max-width:100%;padding:0.6em 0.75em;background:var(--canvas-bg-deep);border-color:transparent;border-radius:8px}"],
harness/page/styles/cascade-order.json:745
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-piece[data-kind=\"img\"]{flex-direction:column;align-items:stretch;padding:0;background:none;white-space:normal}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-piece[data-kind=\"img\"]{flex-direction:column;align-items:stretch;padding:0;background:none;white-space:normal}"],
harness/page/styles/cascade-order.json:746
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-piece[data-kind=\"img\"] img{display:block;width:100%;border-radius:6px}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-piece[data-kind=\"img\"] img{display:block;width:100%;border-radius:6px}"],
harness/page/styles/cascade-order.json:747
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-piece[data-kind=\"img\"]:has(img) > span{display:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-piece[data-kind=\"img\"]:has(img) > span{display:none}"],
harness/page/styles/cascade-order.json:748
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-piece[data-kind=\"img\"]:not(:has(img)){width:100% !important;min-height:3em;justify-content:center;align-items:center;background:var(--canvas-bg-deep);color:var(--canvas-muted);font-size:0.875em}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-piece[data-kind=\"img\"]:not(:has(img)){width:100% !important;min-height:3em;justify-content:center;align-items:center;background:var(--canvas-bg-deep);color:var(--canvas-muted);font-size:0.875em}"],
harness/page/styles/cascade-order.json:749
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-piece[data-kind=\"img\"]:not(:has(img)) > span::before{content:\"🖼 \"}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-piece[data-kind=\"img\"]:not(:has(img)) > span::before{content:\"🖼 \"}"],
harness/page/styles/cascade-order.json:750
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-piece.pce-dragging{opacity:0.3}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-piece.pce-dragging{opacity:0.3}"],
harness/page/styles/cascade-order.json:751
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-drag-ghost{position:fixed;z-index:var(--canvas-z-float, 30);pointer-events:none;opacity:0.92;rotate:2deg;border-radius:8px;filter:drop-shadow(0 10px 14px rgb(0 0 0 / 22%))}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-drag-ghost{position:fixed;z-index:var(--canvas-z-float, 30);pointer-events:none;opacity:0.92;rotate:2deg;border-radius:8px;filter:drop-shadow(0 10px 14px rgb(0 0 0 / 22%))}"],
harness/page/styles/cascade-order.json:752
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .stage[data-ghosting] :is(.pen-selection,.pen-selection-box,.pen-size,.pen-kin,.pen-handle,.pen-anchor){visibility:hidden}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .stage[data-ghosting] :is(.pen-selection,.pen-selection-box,.pen-size,.pen-kin,.pen-handle,.pen-anchor){visibility:hidden}"],
harness/page/styles/cascade-order.json:753
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-ghost{position:absolute;z-index:5;pointer-events:none;margin:0;max-width:190px;opacity:0.9;background:var(--canvas-panel);box-shadow:0 10px 28px rgb(0 0 0 / 22%);rotate:2deg}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-ghost{position:absolute;z-index:5;pointer-events:none;margin:0;max-width:190px;opacity:0.9;background:var(--canvas-panel);box-shadow:0 10px 28px rgb(0 0 0 / 22%);rotate:2deg}"],
harness/page/styles/cascade-order.json:754
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor :is(.pce-caret,.pce-line){position:absolute;display:none;z-index:4;pointer-events:none;background:var(--canvas-accent);border-radius:2px}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor :is(.pce-caret,.pce-line){position:absolute;display:none;z-index:4;pointer-events:none;background:var(--canvas-accent);border-radius:2px}"],
harness/page/styles/cascade-order.json:755
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar{position:absolute;z-index:6;transform-origin:0 0;font:14px/1 var(--canvas-font-sans, system-ui);color:var(--canvas-fg);cursor:default}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar{position:absolute;z-index:6;transform-origin:0 0;font:14px/1 var(--canvas-font-sans, system-ui);color:var(--canvas-fg);cursor:default}"],
harness/page/styles/cascade-order.json:756
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar[data-off]{display:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar[data-off]{display:none}"],
harness/page/styles/cascade-order.json:757
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar:not([data-hidden]){transition:opacity 90ms ease-out;animation:pce-bar-in 90ms ease-out}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar:not([data-hidden]){transition:opacity 90ms ease-out;animation:pce-bar-in 90ms ease-out}"],
harness/page/styles/cascade-order.json:758
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar[data-hidden]{visibility:hidden;opacity:0}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar[data-hidden]{visibility:hidden;opacity:0}"],
harness/page/styles/cascade-order.json:759
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ @keyframes pce-bar-in{{from { opacity: 0; translate: 0 4px; }}}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ @keyframes pce-bar-in{{from { opacity: 0; translate: 0 4px; }}}"],
harness/page/styles/cascade-order.json:760
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-tools{display:flex;flex-direction:column;align-items:stretch;gap:4px;width:max-content;max-width:calc(100vw - 16px);overflow-x:auto;scrollbar-width:none;padding:5px 6px;background:var(--canvas-panel);border:1px solid var(--canvas-line);border-radius:12px;box-shadow:0 1px 2px rgb(0 0 0 / 6%), 0 6px 18px rgb(0 0 0 / 8%)}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-tools{display:flex;flex-direction:column;align-items:stretch;gap:4px;width:max-content;max-width:calc(100vw - 16px);overflow-x:auto;scrollbar-width:none;padding:5px 6px;background:var(--canvas-panel);border:1px solid var(--canvas-line);border-radius:12px;box-shadow:0 1px 2px rgb(0 0 0 / 6%), 0 6px 18px rgb(0 0 0 / 8%)}"],
harness/page/styles/cascade-order.json:761
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-tools::-webkit-scrollbar{display:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-tools::-webkit-scrollbar{display:none}"],
harness/page/styles/cascade-order.json:762
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-row{display:flex;align-items:center;gap:2px}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-row{display:flex;align-items:center;gap:2px}"],
harness/page/styles/cascade-order.json:763
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar button{all:unset;box-sizing:border-box;flex:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;border-radius:8px;color:var(--canvas-fg);cursor:pointer;white-space:nowrap}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar button{all:unset;box-sizing:border-box;flex:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;border-radius:8px;color:var(--canvas-fg);cursor:pointer;white-space:nowrap}"],
harness/page/styles/cascade-order.json:764
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-icon{width:32px;color:color-mix(in srgb, var(--canvas-fg) 82%, transparent)}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-icon{width:32px;color:color-mix(in srgb, var(--canvas-fg) 82%, transparent)}"],
harness/page/styles/cascade-order.json:765
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar svg{stroke-width:1.5}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar svg{stroke-width:1.5}"],
harness/page/styles/cascade-order.json:766
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar button:hover{background:var(--canvas-line)}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar button:hover{background:var(--canvas-line)}"],
harness/page/styles/cascade-order.json:767
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar button[aria-pressed=\"true\"]{background:var(--canvas-accent-soft);color:var(--canvas-accent)}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar button[aria-pressed=\"true\"]{background:var(--canvas-accent-soft);color:var(--canvas-accent)}"],
harness/page/styles/cascade-order.json:768
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-pick{padding:0 8px 0 10px;border:1px solid var(--canvas-line-strong);justify-content:space-between;margin-right:4px}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-pick{padding:0 8px 0 10px;border:1px solid var(--canvas-line-strong);justify-content:space-between;margin-right:4px}"],
harness/page/styles/cascade-order.json:769
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-pick svg{opacity:0.6}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-pick svg{opacity:0.6}"],
harness/page/styles/cascade-order.json:770
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-pick-block{min-width:128px}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-pick-block{min-width:128px}"],
harness/page/styles/cascade-order.json:771
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-pick-font{min-width:128px;max-width:160px}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-pick-font{min-width:128px;max-width:160px}"],
harness/page/styles/cascade-order.json:772
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-pick-font span{overflow:hidden;text-overflow:ellipsis}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-pick-font span{overflow:hidden;text-overflow:ellipsis}"],
harness/page/styles/cascade-order.json:773
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-pick-size{min-width:92px}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-pick-size{min-width:92px}"],
harness/page/styles/cascade-order.json:774
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-sep{flex:none;width:1px;height:20px;margin:0 6px;background:var(--canvas-line-strong)}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-sep{flex:none;width:1px;height:20px;margin:0 6px;background:var(--canvas-line-strong)}"],
harness/page/styles/cascade-order.json:775
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-menu{position:absolute;top:calc(100% + 6px);display:none;flex-direction:column;min-width:180px;padding:6px;background:var(--canvas-panel);border:1px solid var(--canvas-line);border-radius:12px;box-shadow:0 10px 30px rgb(0 0 0 / 14%)}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-menu{position:absolute;top:calc(100% + 6px);display:none;flex-direction:column;min-width:180px;padding:6px;background:var(--canvas-panel);border:1px solid var(--canvas-line);border-radius:12px;box-shadow:0 10px 30px rgb(0 0 0 / 14%)}"],
harness/page/styles/cascade-order.json:776
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-menu[data-open]{display:flex}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-menu[data-open]{display:flex}"],
harness/page/styles/cascade-order.json:777
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-opt{justify-content:flex-start;padding:0 10px;font-size:14px}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-opt{justify-content:flex-start;padding:0 10px;font-size:14px}"],
harness/page/styles/cascade-order.json:778
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-opt small{color:var(--canvas-muted);font-size:12px}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-opt small{color:var(--canvas-muted);font-size:12px}"],
harness/page/styles/cascade-order.json:779
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-opt-h1{height:40px;font-size:22px;font-weight:600}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-opt-h1{height:40px;font-size:22px;font-weight:600}"],
harness/page/styles/cascade-order.json:780
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-opt-h2{height:36px;font-size:18px;font-weight:600}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-opt-h2{height:36px;font-size:18px;font-weight:600}"],
harness/page/styles/cascade-order.json:781
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-opt-h3{font-size:16px;font-weight:600}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-opt-h3{font-size:16px;font-weight:600}"],
harness/page/styles/cascade-order.json:782
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-opt-quote{color:var(--canvas-muted)}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-opt-quote{color:var(--canvas-muted)}"],
harness/page/styles/cascade-order.json:783
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-opt-code{font-family:var(--canvas-font-mono);font-size:13px}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-opt-code{font-family:var(--canvas-font-mono);font-size:13px}"],
harness/page/styles/cascade-order.json:784
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-size-small{font-size:12px}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-size-small{font-size:12px}"],
harness/page/styles/cascade-order.json:785
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-size-large{font-size:17px}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-size-large{font-size:17px}"],
harness/page/styles/cascade-order.json:786
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-size-huge{font-size:21px}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-size-huge{font-size:21px}"],
harness/page/styles/cascade-order.json:787
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-menu.pce-fonts{max-height:340px;overflow-y:auto;overscroll-behavior:contain;min-width:220px}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-menu.pce-fonts{max-height:340px;overflow-y:auto;overscroll-behavior:contain;min-width:220px}"],
harness/page/styles/cascade-order.json:788
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-menu.pce-fonts .pce-opt{font-size:15px}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-menu.pce-fonts .pce-opt{font-size:15px}"],
harness/page/styles/cascade-order.json:789
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-group{padding:10px 10px 4px;font-size:11px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:var(--canvas-muted)}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-group{padding:10px 10px 4px;font-size:11px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:var(--canvas-muted)}"],
harness/page/styles/cascade-order.json:790
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-menu.pce-swatches[data-open]{flex-flow:row wrap;gap:4px;width:172px;min-width:0}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-menu.pce-swatches[data-open]{flex-flow:row wrap;gap:4px;width:172px;min-width:0}"],
harness/page/styles/cascade-order.json:791
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-menu.pce-swatches .pce-opt{flex-basis:100%}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-menu.pce-swatches .pce-opt{flex-basis:100%}"],
harness/page/styles/cascade-order.json:792
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-sw{width:24px;height:24px;border-radius:50%;border:1px solid var(--canvas-line-strong)}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-sw{width:24px;height:24px;border-radius:50%;border:1px solid var(--canvas-line-strong)}"],
harness/page/styles/cascade-order.json:793
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-sw[data-hl=\"yellow\"]{background:#facc15}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-sw[data-hl=\"yellow\"]{background:#facc15}"],
harness/page/styles/cascade-order.json:794
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-sw[data-hl=\"orange\"]{background:#fb923c}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-sw[data-hl=\"orange\"]{background:#fb923c}"],
harness/page/styles/cascade-order.json:795
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-sw[data-hl=\"red\"]{background:#f87171}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-sw[data-hl=\"red\"]{background:#f87171}"],
harness/page/styles/cascade-order.json:796
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-sw[data-hl=\"green\"]{background:#4ade80}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-sw[data-hl=\"green\"]{background:#4ade80}"],
harness/page/styles/cascade-order.json:797
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-sw[data-hl=\"blue\"]{background:#38bdf8}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-sw[data-hl=\"blue\"]{background:#38bdf8}"],
harness/page/styles/cascade-order.json:798
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-sw[data-hl=\"purple\"]{background:#c084fc}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-sw[data-hl=\"purple\"]{background:#c084fc}"],
harness/page/styles/cascade-order.json:799
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-swatch-fg{width:24px;height:24px;font-weight:700;font-size:15px}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-swatch-fg{width:24px;height:24px;font-weight:700;font-size:15px}"],
harness/page/styles/cascade-order.json:800
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-swatch-fg[data-fg=\"red\"]{color:#d92e3c}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-swatch-fg[data-fg=\"red\"]{color:#d92e3c}"],
harness/page/styles/cascade-order.json:801
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-swatch-fg[data-fg=\"orange\"]{color:#c2410c}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-swatch-fg[data-fg=\"orange\"]{color:#c2410c}"],
harness/page/styles/cascade-order.json:802
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-swatch-fg[data-fg=\"yellow\"]{color:#a16207}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-swatch-fg[data-fg=\"yellow\"]{color:#a16207}"],
harness/page/styles/cascade-order.json:803
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-swatch-fg[data-fg=\"green\"]{color:#15803d}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-swatch-fg[data-fg=\"green\"]{color:#15803d}"],
harness/page/styles/cascade-order.json:804
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-swatch-fg[data-fg=\"blue\"]{color:#2563eb}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-swatch-fg[data-fg=\"blue\"]{color:#2563eb}"],
harness/page/styles/cascade-order.json:805
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-swatch-fg[data-fg=\"purple\"]{color:#7c3aed}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .pen-card-editor .pce-bar .pce-swatch-fg[data-fg=\"purple\"]{color:#7c3aed}"],
harness/page/styles/cascade-order.json:806
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .card-node .placeholder{display:flex;align-items:center;justify-content:center;height:100%;color:var(--canvas-faint);font-family:var(--canvas-font-mono);font-size:var(--canvas-type-ui)}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .card-node .placeholder{display:flex;align-items:center;justify-content:center;height:100%;color:var(--canvas-faint);font-family:var(--canvas-font-mono);font-size:var(--canvas-type-ui)}"],
harness/page/styles/cascade-order.json:807
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .stage[data-previewing=\"true\"] .card-node > .shade{outline-color:var(--canvas-warn)}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .stage[data-previewing=\"true\"] .card-node > .shade{outline-color:var(--canvas-warn)}"],
harness/page/styles/cascade-order.json:808
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .card-node > .plain-card-bar{color:transparent}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .card-node > .plain-card-bar{color:transparent}"],
harness/page/styles/cascade-order.json:809
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .plain-card-bar{position:absolute;left:0;bottom:100%;max-width:100%;padding:0 2px 4px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:12px;color:var(--canvas-muted);cursor:grab;user-select:none;touch-action:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .plain-card-bar{position:absolute;left:0;bottom:100%;max-width:100%;padding:0 2px 4px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:12px;color:var(--canvas-muted);cursor:grab;user-select:none;touch-action:none}"],
harness/page/styles/cascade-order.json:810
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .card-scripts-off{position:absolute;right:0;bottom:calc(100% + 2px);z-index:2;padding:2px 8px;font:inherit;font-size:12px;color:var(--canvas-fg);background:var(--canvas-panel);border:1px solid var(--canvas-line-strong);border-radius:6px;cursor:pointer}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .card-scripts-off{position:absolute;right:0;bottom:calc(100% + 2px);z-index:2;padding:2px 8px;font:inherit;font-size:12px;color:var(--canvas-fg);background:var(--canvas-panel);border:1px solid var(--canvas-line-strong);border-radius:6px;cursor:pointer}"],
harness/page/styles/cascade-order.json:811
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ :where(.decks-canvas,.decks-layer) .app-surface{--app-bg:#ffffff;--app-fg:#1d1d1f;--app-muted:rgb(60 60 67 / 60%);--app-edge:rgb(0 0 0 / 10%);position:absolute;left:0;right:0;bottom:0;display:flex;flex-direction:column;overflow:hidden;background:var(--app-bg);color:var(--app-fg);font:13px/1.4 -apple-system, BlinkMacSystemFont, \"SF Pro Text\", var(--canvas-font-sans, system-ui), sans-serif}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ :where(.decks-canvas,.decks-layer) .app-surface{--app-bg:#ffffff;--app-fg:#1d1d1f;--app-muted:rgb(60 60 67 / 60%);--app-edge:rgb(0 0 0 / 10%);position:absolute;left:0;right:0;bottom:0;display:flex;flex-direction:column;overflow:hidden;background:var(--app-bg);color:var(--app-fg);font:13px/1.4 -apple-system, BlinkMacSystemFont, \"SF Pro Text\", var(--canvas-font-sans, system-ui), sans-serif}"],
harness/page/styles/cascade-order.json:812
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ [data-color-scheme=\"dark\"] :where(.decks-canvas,.decks-layer) .app-surface{--app-bg:#1f1f21;--app-fg:#f5f5f7;--app-muted:rgb(235 235 245 / 55%);--app-edge:rgb(255 255 255 / 12%)}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ [data-color-scheme=\"dark\"] :where(.decks-canvas,.decks-layer) .app-surface{--app-bg:#1f1f21;--app-fg:#f5f5f7;--app-muted:rgb(235 235 245 / 55%);--app-edge:rgb(255 255 255 / 12%)}"],
harness/page/styles/cascade-order.json:813
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ :where(.decks-canvas,.decks-layer) .card-node > .app-grip{position:absolute;top:0;left:0;right:0;z-index:2;cursor:grab;touch-action:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ :where(.decks-canvas,.decks-layer) .card-node > .app-grip{position:absolute;top:0;left:0;right:0;z-index:2;cursor:grab;touch-action:none}"],
harness/page/styles/cascade-order.json:814
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ :where(.decks-canvas,.decks-layer) .app-surface-body{display:flex;flex:1;flex-direction:column;align-items:center;justify-content:center;gap:14px}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ :where(.decks-canvas,.decks-layer) .app-surface-body{display:flex;flex:1;flex-direction:column;align-items:center;justify-content:center;gap:14px}"],
harness/page/styles/cascade-order.json:815
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ :where(.decks-canvas,.decks-layer) .app-surface-body p{margin:0;color:var(--app-muted);font-size:14px}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ :where(.decks-canvas,.decks-layer) .app-surface-body p{margin:0;color:var(--app-muted);font-size:14px}"],
harness/page/styles/cascade-order.json:816
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ :where(.decks-canvas,.decks-layer) .app-surface-open{padding:7px 22px;border:0;border-radius:999px;background:#0a84ff;color:#fff;cursor:pointer;font:inherit;font-size:14px;font-weight:500}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ :where(.decks-canvas,.decks-layer) .app-surface-open{padding:7px 22px;border:0;border-radius:999px;background:#0a84ff;color:#fff;cursor:pointer;font:inherit;font-size:14px;font-weight:500}"],
harness/page/styles/cascade-order.json:817
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ :where(.decks-canvas,.decks-layer) .app-surface-open:hover{background:#0077ed}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ :where(.decks-canvas,.decks-layer) .app-surface-open:hover{background:#0077ed}"],
harness/page/styles/cascade-order.json:818
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ :where(.decks-canvas,.decks-layer) .app-surface-frame{display:block;flex:1;width:100%;min-height:0;border:0;background:var(--app-bg);color-scheme:light}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ :where(.decks-canvas,.decks-layer) .app-surface-frame{display:block;flex:1;width:100%;min-height:0;border:0;background:var(--app-bg);color-scheme:light}"],
harness/page/styles/cascade-order.json:819
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ :where(.decks-canvas,.decks-layer) .card-node[data-covered] .document-surface{visibility:hidden}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ :where(.decks-canvas,.decks-layer) .card-node[data-covered] .document-surface{visibility:hidden}"],
harness/page/styles/cascade-order.json:820
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ :where(.decks-canvas,.decks-layer) .card-node[data-covered] .app-surface-frame{display:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ :where(.decks-canvas,.decks-layer) .card-node[data-covered] .app-surface-frame{display:none}"],
harness/page/styles/cascade-order.json:821
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ [data-color-scheme=\"dark\"] :where(.decks-canvas,.decks-layer) .app-surface-frame{color-scheme:dark}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ [data-color-scheme=\"dark\"] :where(.decks-canvas,.decks-layer) .app-surface-frame{color-scheme:dark}"],
harness/page/styles/cascade-order.json:822
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ :where(.decks-canvas,.decks-layer) .document-surface .dp{height:100%}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ :where(.decks-canvas,.decks-layer) .document-surface .dp{height:100%}"],
harness/page/styles/cascade-order.json:823
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-side,.world > .pen-anchor{position:absolute;z-index:3;box-sizing:border-box;border:0;border-radius:50%;background:var(--canvas-panel);box-shadow:inset 0 0 0 1.5px var(--canvas-accent)}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-side,.world > .pen-anchor{position:absolute;z-index:3;box-sizing:border-box;border:0;border-radius:50%;background:var(--canvas-panel);box-shadow:inset 0 0 0 1.5px var(--canvas-accent)}"],
harness/page/styles/cascade-order.json:824
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-side{pointer-events:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-side{pointer-events:none}"],
harness/page/styles/cascade-order.json:825
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-side[data-on=\"true\"]{background:var(--canvas-accent)}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-side[data-on=\"true\"]{background:var(--canvas-accent)}"],
harness/page/styles/cascade-order.json:826
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-anchor{background:color-mix(in srgb, var(--canvas-accent) 22%, var(--canvas-panel));cursor:crosshair;opacity:0.85}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-anchor{background:color-mix(in srgb, var(--canvas-accent) 22%, var(--canvas-panel));cursor:crosshair;opacity:0.85}"],
harness/page/styles/cascade-order.json:827
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-anchor:hover{background:var(--canvas-accent);opacity:1}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ .world > .pen-anchor:hover{background:var(--canvas-accent);opacity:1}"],
harness/page/styles/cascade-order.json:828
  - ["packages/canvas/styles/canvas.css","@layer decks.surface ▸ @media (prefers-reduced-motion: reduce) ▸ .card-node > .news-glow::after{animation:none}"],
  + ["canvas/styles/canvas.css","@layer decks.surface ▸ @media (prefers-reduced-motion: reduce) ▸ .card-node > .news-glow::after{animation:none}"],
harness/page/styles/cascade-order.json:969
  - ["packages/canvas/styles/ink.css","@layer decks.surface ▸ .stage-ink{position:absolute;left:0;top:0;z-index:1;overflow:visible;pointer-events:auto;touch-action:none;cursor:crosshair;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}"],
  + ["canvas/styles/ink.css","@layer decks.surface ▸ .stage-ink{position:absolute;left:0;top:0;z-index:1;overflow:visible;pointer-events:auto;touch-action:none;cursor:crosshair;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}"],
harness/page/styles/cascade-order.json:970
  - ["packages/canvas/styles/ink.css","@layer decks.surface ▸ .stage-ink[data-pencil]{pointer-events:none}"],
  + ["canvas/styles/ink.css","@layer decks.surface ▸ .stage-ink[data-pencil]{pointer-events:none}"],
harness/page/styles/cascade-order.json:971
  - ["packages/canvas/styles/ink.css","@layer decks.surface ▸ .stage-ink[data-pencil] .ink-selection,.stage-ink[data-pencil] .ink-corner{pointer-events:auto}"],
  + ["canvas/styles/ink.css","@layer decks.surface ▸ .stage-ink[data-pencil] .ink-selection,.stage-ink[data-pencil] .ink-corner{pointer-events:auto}"],
harness/page/styles/cascade-order.json:972
  - ["packages/canvas/styles/ink.css","@layer decks.surface ▸ .stage-ink[data-tool=\"eraser\"]{cursor:cell}"],
  + ["canvas/styles/ink.css","@layer decks.surface ▸ .stage-ink[data-tool=\"eraser\"]{cursor:cell}"],
harness/page/styles/cascade-order.json:973
  - ["packages/canvas/styles/ink.css","@layer decks.surface ▸ .stage-ink[data-tool=\"lasso\"]{cursor:default}"],
  + ["canvas/styles/ink.css","@layer decks.surface ▸ .stage-ink[data-tool=\"lasso\"]{cursor:default}"],
harness/page/styles/cascade-order.json:974
  - ["packages/canvas/styles/ink.css","@layer decks.surface ▸ .ink-loop,.ink-selection{fill:none;stroke:var(--canvas-accent);stroke-width:1.5;stroke-dasharray:5 4;vector-effect:non-scaling-stroke}"],
  + ["canvas/styles/ink.css","@layer decks.surface ▸ .ink-loop,.ink-selection{fill:none;stroke:var(--canvas-accent);stroke-width:1.5;stroke-dasharray:5 4;vector-effect:non-scaling-stroke}"],
harness/page/styles/cascade-order.json:975
  - ["packages/canvas/styles/ink.css","@layer decks.surface ▸ .ink-selection{fill:color-mix(in srgb, var(--canvas-accent) 8%, transparent);cursor:move}"],
  + ["canvas/styles/ink.css","@layer decks.surface ▸ .ink-selection{fill:color-mix(in srgb, var(--canvas-accent) 8%, transparent);cursor:move}"],
harness/page/styles/cascade-order.json:976
  - ["packages/canvas/styles/ink.css","@layer decks.surface ▸ .ink-corner{fill:var(--canvas-panel);stroke:var(--canvas-accent)}"],
  + ["canvas/styles/ink.css","@layer decks.surface ▸ .ink-corner{fill:var(--canvas-panel);stroke:var(--canvas-accent)}"],
harness/page/styles/cascade-order.json:977
  - ["packages/canvas/styles/ink.css","@layer decks.surface ▸ .ink-corner:is([data-corner=\"nw\"],[data-corner=\"se\"]){cursor:nwse-resize}"],
  + ["canvas/styles/ink.css","@layer decks.surface ▸ .ink-corner:is([data-corner=\"nw\"],[data-corner=\"se\"]){cursor:nwse-resize}"],
harness/page/styles/cascade-order.json:978
  - ["packages/canvas/styles/ink.css","@layer decks.surface ▸ .ink-corner:is([data-corner=\"ne\"],[data-corner=\"sw\"]){cursor:nesw-resize}"],
  + ["canvas/styles/ink.css","@layer decks.surface ▸ .ink-corner:is([data-corner=\"ne\"],[data-corner=\"sw\"]){cursor:nesw-resize}"],
harness/page/styles/cascade-order.json:1166
  - ["packages/canvas/styles/marks.css","@layer decks.surface ▸ .edit-mark{position:absolute;z-index:4;box-sizing:border-box;pointer-events:none;--line-w:calc(1.5px / var(--zoom, 1));--mark-r:calc(8px / var(--zoom, 1));--glow:calc(18px / var(--zoom, 1));--spread:calc(4px / var(--zoom, 1));border-radius:var(--mark-r);outline:var(--line-w) solid var(--act);outline-offset:calc(var(--line-w) * 2);overflow:hidden;animation:mark-print 820ms ease-in-out both}"],
  + ["canvas/styles/marks.css","@layer decks.surface ▸ .edit-mark{position:absolute;z-index:4;box-sizing:border-box;pointer-events:none;--line-w:calc(1.5px / var(--zoom, 1));--mark-r:calc(8px / var(--zoom, 1));--glow:calc(18px / var(--zoom, 1));--spread:calc(4px / var(--zoom, 1));border-radius:var(--mark-r);outline:var(--line-w) solid var(--act);outline-offset:calc(var(--line-w) * 2);overflow:hidden;animation:mark-print 820ms ease-in-out both}"],
harness/page/styles/cascade-order.json:1167
  - ["packages/canvas/styles/marks.css","@layer decks.surface ▸ .edit-mark::before{content:\"\";position:absolute;inset:0;background:linear-gradient(90deg, transparent 0, color-mix(in srgb, var(--act) 42%, transparent) 55%, transparent 100%);background-size:55% 100%;background-repeat:no-repeat;animation:mark-sweep 480ms ease-out both}"],
  + ["canvas/styles/marks.css","@layer decks.surface ▸ .edit-mark::before{content:\"\";position:absolute;inset:0;background:linear-gradient(90deg, transparent 0, color-mix(in srgb, var(--act) 42%, transparent) 55%, transparent 100%);background-size:55% 100%;background-repeat:no-repeat;animation:mark-sweep 480ms ease-out both}"],
harness/page/styles/cascade-order.json:1168
  - ["packages/canvas/styles/marks.css","@layer decks.surface ▸ .edit-mark::after{content:\"\";position:absolute;top:0;bottom:0;width:calc(14px / var(--zoom, 1));background:linear-gradient(90deg, transparent, rgb(255 255 255 / 92%) 50%, transparent);animation:mark-head 480ms ease-out both}"],
  + ["canvas/styles/marks.css","@layer decks.surface ▸ .edit-mark::after{content:\"\";position:absolute;top:0;bottom:0;width:calc(14px / var(--zoom, 1));background:linear-gradient(90deg, transparent, rgb(255 255 255 / 92%) 50%, transparent);animation:mark-head 480ms ease-out both}"],
harness/page/styles/cascade-order.json:1169
  - ["packages/canvas/styles/marks.css","@layer decks.surface ▸ .edit-mark[data-kind=\"move\"]{animation:mark-outline 700ms ease-in-out both}"],
  + ["canvas/styles/marks.css","@layer decks.surface ▸ .edit-mark[data-kind=\"move\"]{animation:mark-outline 700ms ease-in-out both}"],
harness/page/styles/cascade-order.json:1170
  - ["packages/canvas/styles/marks.css","@layer decks.surface ▸ .edit-mark[data-kind=\"delete\"]{transform-origin:center;animation:mark-dissolve 600ms ease-in both}"],
  + ["canvas/styles/marks.css","@layer decks.surface ▸ .edit-mark[data-kind=\"delete\"]{transform-origin:center;animation:mark-dissolve 600ms ease-in both}"],
harness/page/styles/cascade-order.json:1171
  - ["packages/canvas/styles/marks.css","@layer decks.surface ▸ .edit-mark[data-kind=\"move\"]::before,.edit-mark[data-kind=\"move\"]::after,.edit-mark[data-kind=\"delete\"]::before,.edit-mark[data-kind=\"delete\"]::after{display:none}"],
  + ["canvas/styles/marks.css","@layer decks.surface ▸ .edit-mark[data-kind=\"move\"]::before,.edit-mark[data-kind=\"move\"]::after,.edit-mark[data-kind=\"delete\"]::before,.edit-mark[data-kind=\"delete\"]::after{display:none}"],
harness/page/styles/cascade-order.json:1172
  - ["packages/canvas/styles/marks.css","@layer decks.surface ▸ @keyframes mark-print{{0% { background: color-mix(in srgb, var(--act) 22%, transparent); box-shadow: 0 0 0 0 color-mix(in srgb, var(--act) 60%, transparent); outline-color: var(--act); } 35% { background: color-mix(in srgb, var(--act) 16%, transparent); box-shadow: 0 0 var(--glow) var(--spread) color-mix(in srgb, var(--act) 45%, transparent); outline-color: var(--act); } 100% { background: transparent; box-shadow: 0 0 var(--glow) var(--spread) transparent; outline-color: transparent; }}}"],
  + ["canvas/styles/marks.css","@layer decks.surface ▸ @keyframes mark-print{{0% { background: color-mix(in srgb, var(--act) 22%, transparent); box-shadow: 0 0 0 0 color-mix(in srgb, var(--act) 60%, transparent); outline-color: var(--act); } 35% { background: color-mix(in srgb, var(--act) 16%, transparent); box-shadow: 0 0 var(--glow) var(--spread) color-mix(in srgb, var(--act) 45%, transparent); outline-color: var(--act); } 100% { background: transparent; box-shadow: 0 0 var(--glow) var(--spread) transparent; outline-color: transparent; }}}"],
harness/page/styles/cascade-order.json:1173
  - ["packages/canvas/styles/marks.css","@layer decks.surface ▸ @keyframes mark-sweep{{from { background-position: -55% 0; } to { background-position: 155% 0; }}}"],
  + ["canvas/styles/marks.css","@layer decks.surface ▸ @keyframes mark-sweep{{from { background-position: -55% 0; } to { background-position: 155% 0; }}}"],
harness/page/styles/cascade-order.json:1174
  - ["packages/canvas/styles/marks.css","@layer decks.surface ▸ @keyframes mark-head{{from { left: -8%; opacity: 1; } to { left: 104%; opacity: 0; }}}"],
  + ["canvas/styles/marks.css","@layer decks.surface ▸ @keyframes mark-head{{from { left: -8%; opacity: 1; } to { left: 104%; opacity: 0; }}}"],
harness/page/styles/cascade-order.json:1175
  - ["packages/canvas/styles/marks.css","@layer decks.surface ▸ @keyframes mark-outline{{0% { outline-color: var(--act); box-shadow: 0 0 0 0 color-mix(in srgb, var(--act) 55%, transparent); } 40% { box-shadow: 0 0 var(--glow) var(--spread) color-mix(in srgb, var(--act) 40%, transparent); } 100% { outline-color: transparent; box-shadow: 0 0 var(--glow) var(--spread) transparent; }}}"],
  + ["canvas/styles/marks.css","@layer decks.surface ▸ @keyframes mark-outline{{0% { outline-color: var(--act); box-shadow: 0 0 0 0 color-mix(in srgb, var(--act) 55%, transparent); } 40% { box-shadow: 0 0 var(--glow) var(--spread) color-mix(in srgb, var(--act) 40%, transparent); } 100% { outline-color: transparent; box-shadow: 0 0 var(--glow) var(--spread) transparent; }}}"],
harness/page/styles/cascade-order.json:1176
  - ["packages/canvas/styles/marks.css","@layer decks.surface ▸ @keyframes mark-dissolve{{0% { opacity: 1; transform: scale(1); background: color-mix(in srgb, var(--act) 26%, transparent); } 100% { opacity: 0; transform: scale(0.9); background: transparent; }}}"],
  + ["canvas/styles/marks.css","@layer decks.surface ▸ @keyframes mark-dissolve{{0% { opacity: 1; transform: scale(1); background: color-mix(in srgb, var(--act) 26%, transparent); } 100% { opacity: 0; transform: scale(0.9); background: transparent; }}}"],
harness/page/styles/cascade-order.json:1177
  - ["packages/canvas/styles/marks.css","@layer decks.surface ▸ @media (prefers-reduced-motion: reduce) ▸ .edit-mark{display:none}"],
  + ["canvas/styles/marks.css","@layer decks.surface ▸ @media (prefers-reduced-motion: reduce) ▸ .edit-mark{display:none}"],
harness/page/styles/cascade-order.json:1178
  - ["packages/canvas/styles/marks.css","@layer decks.surface ▸ .agent-cursor{--cursor-soft:color-mix(in srgb, var(--cursor-color) 52%, #fff);position:absolute;z-index:4;width:0;height:0;transform:scale(calc(1 / var(--zoom, 1)));transform-origin:0 0;pointer-events:none;will-change:transform;transition:left 380ms cubic-bezier(0.2, 0.7, 0.2, 1), top 380ms cubic-bezier(0.2, 0.7, 0.2, 1), opacity 600ms ease-out}"],
  + ["canvas/styles/marks.css","@layer decks.surface ▸ .agent-cursor{--cursor-soft:color-mix(in srgb, var(--cursor-color) 52%, #fff);position:absolute;z-index:4;width:0;height:0;transform:scale(calc(1 / var(--zoom, 1)));transform-origin:0 0;pointer-events:none;will-change:transform;transition:left 380ms cubic-bezier(0.2, 0.7, 0.2, 1), top 380ms cubic-bezier(0.2, 0.7, 0.2, 1), opacity 600ms ease-out}"],
harness/page/styles/cascade-order.json:1179
  - ["packages/canvas/styles/marks.css","@layer decks.surface ▸ .agent-cursor[data-jump=\"true\"]{transition:none;animation:cursor-in 220ms ease-out}"],
  + ["canvas/styles/marks.css","@layer decks.surface ▸ .agent-cursor[data-jump=\"true\"]{transition:none;animation:cursor-in 220ms ease-out}"],
harness/page/styles/cascade-order.json:1180
  - ["packages/canvas/styles/marks.css","@layer decks.surface ▸ .agent-cursor[data-gone=\"true\"]{opacity:0}"],
  + ["canvas/styles/marks.css","@layer decks.surface ▸ .agent-cursor[data-gone=\"true\"]{opacity:0}"],
harness/page/styles/cascade-order.json:1181
  - ["packages/canvas/styles/marks.css","@layer decks.surface ▸ .agent-cursor .arrow{position:absolute;top:-3px;left:-3px;overflow:visible;filter:drop-shadow(0 1px 2px rgb(0 0 0 / 28%));animation:cursor-float 4.6s ease-in-out infinite}"],
  + ["canvas/styles/marks.css","@layer decks.surface ▸ .agent-cursor .arrow{position:absolute;top:-3px;left:-3px;overflow:visible;filter:drop-shadow(0 1px 2px rgb(0 0 0 / 28%));animation:cursor-float 4.6s ease-in-out infinite}"],
harness/page/styles/cascade-order.json:1182
  - ["packages/canvas/styles/marks.css","@layer decks.surface ▸ .agent-cursor .arrow path{fill:var(--cursor-soft);stroke:#fff;stroke-width:1.6;stroke-linejoin:round}"],
  + ["canvas/styles/marks.css","@layer decks.surface ▸ .agent-cursor .arrow path{fill:var(--cursor-soft);stroke:#fff;stroke-width:1.6;stroke-linejoin:round}"],
harness/page/styles/cascade-order.json:1183
  - ["packages/canvas/styles/marks.css","@layer decks.surface ▸ .agent-cursor .ring{position:absolute;left:0;top:0;width:8px;height:8px;margin:-4px 0 0 -4px;border:2px solid var(--cursor-color);border-radius:var(--canvas-radius-pill);opacity:0;animation:cursor-ping 520ms cubic-bezier(0.2, 0.7, 0.2, 1)}"],
  + ["canvas/styles/marks.css","@layer decks.surface ▸ .agent-cursor .ring{position:absolute;left:0;top:0;width:8px;height:8px;margin:-4px 0 0 -4px;border:2px solid var(--cursor-color);border-radius:var(--canvas-radius-pill);opacity:0;animation:cursor-ping 520ms cubic-bezier(0.2, 0.7, 0.2, 1)}"],
harness/page/styles/cascade-order.json:1184
  - ["packages/canvas/styles/marks.css","@layer decks.surface ▸ .agent-cursor .label{position:absolute;top:22px;left:20px;padding:2px 8px;border-radius:4px;background:var(--cursor-soft);box-shadow:0 1px 3px rgb(0 0 0 / 18%);color:#11131a;font-size:13px;font-weight:500;line-height:18px;white-space:nowrap;transition:transform 240ms cubic-bezier(0.2, 0.7, 0.2, 1) 60ms}"],
  + ["canvas/styles/marks.css","@layer decks.surface ▸ .agent-cursor .label{position:absolute;top:22px;left:20px;padding:2px 8px;border-radius:4px;background:var(--cursor-soft);box-shadow:0 1px 3px rgb(0 0 0 / 18%);color:#11131a;font-size:13px;font-weight:500;line-height:18px;white-space:nowrap;transition:transform 240ms cubic-bezier(0.2, 0.7, 0.2, 1) 60ms}"],
harness/page/styles/cascade-order.json:1185
  - ["packages/canvas/styles/marks.css","@layer decks.surface ▸ .agent-cursor[data-moving=\"true\"] .label{transform:translate(-6px, -4px)}"],
  + ["canvas/styles/marks.css","@layer decks.surface ▸ .agent-cursor[data-moving=\"true\"] .label{transform:translate(-6px, -4px)}"],
harness/page/styles/cascade-order.json:1186
  - ["packages/canvas/styles/marks.css","@layer decks.surface ▸ @keyframes cursor-float{{0%, 100% { transform: translate(0, 0); } 35% { transform: translate(0.5px, -2px); } 65% { transform: translate(-0.5px, -1.2px); }}}"],
  + ["canvas/styles/marks.css","@layer decks.surface ▸ @keyframes cursor-float{{0%, 100% { transform: translate(0, 0); } 35% { transform: translate(0.5px, -2px); } 65% { transform: translate(-0.5px, -1.2px); }}}"],
harness/page/styles/cascade-order.json:1187
  - ["packages/canvas/styles/marks.css","@layer decks.surface ▸ @keyframes cursor-ping{{from { width: 8px; height: 8px; margin: -4px 0 0 -4px; opacity: 0.85; } to { width: 64px; height: 64px; margin: -32px 0 0 -32px; opacity: 0; }}}"],
  + ["canvas/styles/marks.css","@layer decks.surface ▸ @keyframes cursor-ping{{from { width: 8px; height: 8px; margin: -4px 0 0 -4px; opacity: 0.85; } to { width: 64px; height: 64px; margin: -32px 0 0 -32px; opacity: 0; }}}"],
harness/page/styles/cascade-order.json:1188
  - ["packages/canvas/styles/marks.css","@layer decks.surface ▸ @keyframes cursor-in{{from { opacity: 0; }}}"],
  + ["canvas/styles/marks.css","@layer decks.surface ▸ @keyframes cursor-in{{from { opacity: 0; }}}"],
harness/page/styles/cascade-order.json:1189
  - ["packages/canvas/styles/marks.css","@layer decks.surface ▸ @media (prefers-reduced-motion: reduce) ▸ .agent-cursor,.agent-cursor .label{transition:none}"],
  + ["canvas/styles/marks.css","@layer decks.surface ▸ @media (prefers-reduced-motion: reduce) ▸ .agent-cursor,.agent-cursor .label{transition:none}"],
harness/page/styles/cascade-order.json:1190
  - ["packages/canvas/styles/marks.css","@layer decks.surface ▸ @media (prefers-reduced-motion: reduce) ▸ .agent-cursor .arrow,.agent-cursor .ring,.agent-cursor[data-jump=\"true\"]{animation:none}"],
  + ["canvas/styles/marks.css","@layer decks.surface ▸ @media (prefers-reduced-motion: reduce) ▸ .agent-cursor .arrow,.agent-cursor .ring,.agent-cursor[data-jump=\"true\"]{animation:none}"],
harness/page/tsconfig.json:12
  - "include": ["**/*.ts", "**/*.tsx", "../../packages/canvas/src/**/*.d.ts"],
  + "include": ["**/*.ts", "**/*.tsx", "../../canvas/**/*.d.ts"],
canvas/package.json:8
  - ".": "./src/index.ts",
  + ".": "./index.ts",
canvas/package.json:9
  - "./comments": "./src/public/comments.ts",
  + "./comments": "./public/comments.ts",
canvas/package.json:10
  - "./tools": "./src/public/tools.ts",
  + "./tools": "./public/tools.ts",
canvas/package.json:11
  - "./camera": "./src/public/camera.ts",
  + "./camera": "./public/camera.ts",
canvas/package.json:12
  - "./host": "./src/public/host.ts",
  + "./host": "./public/host.ts",
canvas/package.json:13
  - "./card-reading": "./src/items/card-reading.ts",
  + "./card-reading": "./items/card-reading.ts",
canvas/package.json:14
  - "./card": "./src/items/card.ts",
  + "./card": "./items/card.ts",
canvas/tsconfig.json:2
  - "extends": "../../tsconfig.base.json",
  + "extends": "../tsconfig.base.json",
packages/card-host/lib/card.js:395
  - * frame (`packages/canvas/src/items/card.ts`); a board on its own has no stage and no token.
  + * frame (`canvas/items/card.ts`); a board on its own has no stage and no token.
scripts/build-solid-lib.mjs:2
  - * Build a Solid package's `dist/lib/` (`node scripts/build-solid-lib.mjs packages/canvas`): the package as
  + * Build a Solid package's `dist/lib/` (`node scripts/build-solid-lib.mjs canvas`): the package as
scripts/stale-paths.mjs:19
  - "apps/web/src/lib/media.ts", "runtime/paths.ts", "apps/server/src/browser/bridge.test.ts", "packages/canvas/styles/canvas.css",
  + "apps/web/src/lib/media.ts", "runtime/paths.ts", "apps/server/src/browser/bridge.test.ts", "canvas/styles/canvas.css",
scripts/surface-gate.mjs:19
  - const SURFACE = ["surface-tokens.css", "canvas.css", "ink.css", "marks.css", "host.css"].map((f) => join(ROOT, "packages/canvas/styles", f));
  + const SURFACE = ["surface-tokens.css", "canvas.css", "ink.css", "marks.css", "host.css"].map((f) => join(ROOT, "canvas/styles", f));
scripts/surface-gate.mjs:23
  - const hooks = JSON.parse(readFileSync(join(ROOT, "packages/canvas/styles/surface-hooks.json"), "utf8"));
  + const hooks = JSON.parse(readFileSync(join(ROOT, "canvas/styles/surface-hooks.json"), "utf8"));

## Files the table edits or creates

- package.json
- canvas/README.md

## Warnings

- none

## Old paths still written (not rewritten: comments and docs)

- AGENTS.md: 1
- CONTRIBUTING.md: 1
- docs/DESIGN.md: 3
- docs/REORGANIZATION.md: 20
- docs/STYLING.md: 1
- harness/page/index.html: 1

## Then run

- before: the last four browser checks fixed and committed by the three agents in packages/canvas; Pane told canvas/ui/ is Loom's now
- node tools/heavy.mjs --wait -- npm install
- npm run css:order (or Warden's successor in tools/): regenerates harness/page/styles/cascade-order.json, whose keys name the sheets by path
- build:lib's ../scripts/build-solid-lib.mjs: point at its home in tools/ if Warden moved it
- Warden's adopt command for canvas/ (subfolder READMEs come at step 4e), with --renames 4a-canvas.renames.json
- node tools/check.mjs canvas && node tools/check.mjs harness && node tools/check.mjs server
- node tools/gates/run.mjs
- node tools/heavy.mjs --wait -- node server/frame/build.mjs (the frame page is built from the canvas library)
- all 76 browser checks once, through node tools/checks/run.mjs, one slot per run
- tell Loft: decks-studio's page/package.json file: path is now ../../decks-dev/canvas
- commit with REWRITE_AGENT=Loom: Move the canvas library to the top folder canvas/
