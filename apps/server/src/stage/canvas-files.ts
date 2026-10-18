/**
 * Where a deck keeps its canvases: `canvases/<name>/canvas.pen`, with the name the person reads in
 * `canvas.json` beside it. A canvas is the deck's, not an agent's: its folder is named for what is on
 * it, and an agent only points at the one it is working on (`agents/session.ts`).
 *
 * Decks before 2026-10-16 kept them as `stages/<name>/stage.pen`; `migrations/2026-10-16-stages-to-canvases.ts`
 * moves those once, when the deck opens.
 */
export const CANVAS_DIR = "canvases";
export const CANVAS_FILE = "canvas.pen";
export const CANVAS_META = "canvas.json";

/** The deck-relative path of a canvas's drawing. */
export const canvasFile = (name: string): string => `${CANVAS_DIR}/${name}/${CANVAS_FILE}`;
