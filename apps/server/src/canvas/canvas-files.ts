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

/**
 * A deck-relative path written before canvases moved out of `stages/` (2026-10-16), pointed at where it
 * is now: `stages/<n>/…` → `canvases/<m>/…`, `stage.pen` → `canvas.pen`. `renamed` gives a folder its
 * new name where the move renamed it. Used by the move itself (`migrations/2026-10-16-stages-to-canvases.ts`)
 * and by a call that still names a canvas the old way (`CanvasPens.penFile`).
 */
export function movedPath(path: string, renamed: ReadonlyMap<string, string>): string {
	const match = /^stages\/([^/]+)(\/.*)?$/.exec(path);
	if (!match) return path;
	const name = renamed.get(match[1]!) ?? match[1]!;
	const rest = (match[2] ?? "").replace(/^\/stage\.pen$/, `/${CANVAS_FILE}`).replace(/^\/stage\.json$/, `/${CANVAS_META}`);
	return `${CANVAS_DIR}/${name}${rest}`;
}
