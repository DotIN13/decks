/**
 * The Decks canvas, for any host: the canvas frame (`bootFrame`, in a sandboxed page of its own) and
 * the page's end of it (`createFramedEditor`); `createEditor` makes the editor itself in a Solid tree,
 * as the frame does.
 */
export { createEditor, fitAll, type CanvasHandle, type CanvasOptions, type Editor, type EditorState } from "./editor/editor.tsx";
export type { InkTool } from "./ink/ink.ts";
export { canvasHost, setCanvasHost, type CanvasHost } from "./host/host.ts";
export type { InkRequest, StageComment } from "./types.ts";
export type { PenEdit, PenDocument } from "@decks/pen";
export type { PenTool } from "./editor/pen-tools.ts";
export type { DocEdits, DrawingWriter } from "./render/types.ts";
// The canvas frame (`frame/`): the canvas in a sandboxed page of its own, and the protocol to it.
export { bootFrame } from "./host/inside/frame.tsx";
export type { FrameChrome, FrameChromeView } from "./host/chrome.ts";
export { CallRefused, type FrameCalls } from "./host/messages.ts";
export { createFramedEditor, type CanvasPass, type FramedEditor, type FramedEditorOptions, type FramedHandle, type FrameHostOptions } from "./host/outside/framed-editor.tsx";
