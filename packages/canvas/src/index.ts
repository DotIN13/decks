/**
 * The Decks canvas, for any host: the canvas frame (`bootFrame`, in a sandboxed page of its own) and
 * the page's end of it (`createFramedEditor`); `createEditor` makes the editor itself in a Solid tree,
 * as the frame does.
 */
export { createEditor, fitAll, type CanvasHandle, type CanvasOptions, type Editor, type EditorState } from "./view/editor.tsx";
export type { InkTool } from "./ink/ink.ts";
export { canvasHost, setCanvasHost, type CanvasHost } from "./base/host.ts";
export type { InkRequest, CanvasComment } from "./view/types.ts";
export type { PenEdit, PenDocument } from "@decks/pen";
export type { PenTool } from "./edit/pen-tools.ts";
export type { DocEdits } from "./model/drawing.ts";
export type { DrawingWriter } from "./render/types.ts";
// The canvas frame (`frame/`): the canvas in a sandboxed page of its own, and the protocol to it.
export { bootFrame } from "./frame/inside/frame.tsx";
export type { FrameChrome, FrameChromeView } from "./frame/chrome.ts";
export { CallRefused, type FrameCalls } from "./frame/protocol.ts";
export { createFramedEditor, type CanvasPass, type FramedEditor, type FramedEditorOptions, type FramedHandle, type FrameHostOptions } from "./frame/outside/host.tsx";
// The tools on the page (`FramedEditorOptions.pageTools`): the zoom as the frame's camera has it at each step, for the page's zoom reading.
export { frameZoom } from "./frame/tools-mirror.ts";
