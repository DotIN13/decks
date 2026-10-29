/**
 * The Decks canvas, for any host: `mountCanvas` puts the whole editor in an element, editing a
 * `.pen` document, and reports the person's edits; `createEditor` makes the same editor in a Solid
 * host's own tree (the Decks app). The Decks app mounts the parts itself
 * (`Stage.tsx`, `pen/PenBar.tsx`, …, through `@decks/canvas/<path>`).
 */
export { createEditor, fitAll, mountCanvas, type CanvasHandle, type CanvasOptions, type Editor, type EditorState } from "./mount.tsx";
export type { InkTool } from "./state/ink.ts";
export { boardsOf, createDrawing, type Drawing, type DrawingOptions } from "./drawing.ts";
export { canvasHost, setCanvasHost, type CanvasHost } from "./host.ts";
export { ItemSlot, type ItemSlotExtras, type StageBoardProps } from "./item-slot.tsx";
export { Stage, type InkRequest, type StageComment, type StageShots } from "./Stage.tsx";
export type { PenEdit, PenDocument } from "@decks/pen";
export type { PenTool } from "./state/pen-tools.ts";
export type { DocEdits, DrawingWriter } from "./stage/types.ts";
// The canvas frame (`frame/`): the canvas in a sandboxed page of its own, and the protocol to it.
export { bootFrame } from "./frame/frame.tsx";
export type { FrameChrome, FrameChromeView } from "./frame/chrome.ts";
export { CallRefused, PROTOCOL, peer, type FrameCalls, type FrameToPage, type Message, type Page as FramePage, type PageCalls, type PageEnd, type PageToFrame, type Start as FrameStart } from "./frame/protocol.ts";
export { createFramedEditor, type FrameHostOptions } from "./frame/host.tsx";
