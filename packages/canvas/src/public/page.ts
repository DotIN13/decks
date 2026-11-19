/**
 * The page's end of the canvas, for an app's own page: the frames it makes (`createFramedEditor` for a
 * canvas; `CardFrame`, `DocumentFrame` and `AppFrame` for one item whole) and what it reads of them.
 *
 * Apart from `@decks/canvas` itself, which also has the editor and the drawing engine: a page that
 * shows the canvas in a frame draws none of it, and a page that imported the whole package loaded
 * all of it, megabytes it never ran. What runs inside the frame is `@decks/canvas/frame`.
 */
export { createFramedEditor, type CanvasPass, type FramedEditor, type FramedEditorOptions, type FramedHandle, type FrameHostOptions } from "../frame/outside/host.tsx";
export { CardFrame, type CardFrameProps } from "../frame/card/host.tsx";
export { DocumentFrame, type DocumentFrameProps } from "../frame/document/host.tsx";
export { AppFrame, type AppFramePass, type AppFrameProps } from "../frame/app/host.tsx";
export type { CardShown } from "../frame/card/protocol.ts";
export { CallRefused, type FrameCalls } from "../frame/protocol.ts";
// What kind of device this is, by its operating system (`render/device.ts`): what a page's own budgets go by.
export { DEVICE } from "../render/device.ts";
// The tools on the page (`FramedEditorOptions.pageTools`): the zoom as the frame's camera has it at each step, for the page's zoom reading.
export { frameZoom } from "../frame/tools-mirror.ts";
export type { InkRequest, CanvasComment } from "../view/types.ts";
export type { FrameChrome, FrameChromeView } from "../frame/chrome.ts";
// What an app's own chrome round the canvas uses, none of it the engine: the drawing's tool bar, what the canvas asks its host, the scheme, an agent's view calls, keys, and the knobs and probes the checks reach.
export { PenBar } from "../ui/PenBar.tsx";
export * from "../base/host.ts";
export * from "../camera/view-ops.ts";
export * from "../ui/keycaps.ts";
export * from "../base/theme.ts";
export { knobs, probes, type Knobs, type Probes } from "../base/debug.ts";
