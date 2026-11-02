/**
 * The Decks canvas, for any host: `mountCanvas` puts the whole editor in an element, editing a
 * `.pen` document, and reports the person's edits; `createEditor` makes the same editor in a Solid
 * host's own tree (the Decks app). The Decks app mounts the parts itself
 * (`Stage.tsx`, `panels/PenBar.tsx`, …, through `@decks/canvas/<path>`), with its own boards.
 */
export { createEditor, fitAll, mountCanvas, type CanvasHandle, type CanvasOptions, type Editor, type EditorState } from "./mount.tsx";
export type { InkTool } from "./state/ink.ts";
export { boardsOf, createDrawing, type Drawing, type DrawingOptions } from "./drawing.ts";
export { canvasHost, setCanvasHost, type CanvasHost } from "./host.ts";
export { PlainBoard } from "./stage/plain-board.tsx";
export { createBoardHost, type BoardHost, type MintBoardToken } from "./board/board-host.ts";
export { boardStorageKey, isSharedBoard, sharedFolderOf, SHARED_SANDBOX } from "./board/board-storage.ts";
export { Stage, type InkRequest, type StageComment, type StageShots } from "./stage/Stage.tsx";
export type { StageBoardProps } from "./stage/board-slot.ts";
export type { FrameGestureHost } from "./stage/frame-host.ts";
export type { PenEdit, PenDocument } from "@decks/pen";
export type { PenTool } from "./state/pen-tools.ts";
export type { DocEdits, DrawingWriter } from "./engine/types.ts";
