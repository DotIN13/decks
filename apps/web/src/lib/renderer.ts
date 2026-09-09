/**
 * Which renderer draws the boards, and whether this browser can run the one asked for.
 *
 * Three ways to put a board on the stage, chosen in Settings and remembered per browser:
 *
 * - **`dom`** — every board is an iframe in a positioned box under one CSS transform. The
 *   default, and the only one every browser can do.
 * - **`canvas-per-board`** — the same boxes, but each board's document is the child of a
 *   `<canvas layoutsubtree>` and is drawn into it with `drawElementImage`. The document is
 *   laid out exactly where it is drawn, so clicks and typing still reach it; a pan moves
 *   the pictures and a pinch stretches them, and the board is drawn again only once the
 *   camera rests. A board whose document has been let go keeps its picture.
 * - **`one-canvas`** — one canvas the size of the stage, every mounted document a child of
 *   it, each board kept as a bitmap at the settled zoom and copied on every frame. Boards
 *   are pictures: nothing inside one can be clicked, because Chrome does not yet hit-test a
 *   drawn element where it was drawn. It exists to compare pan and zoom against the others.
 *
 * The two canvas renderers need Chrome's HTML-in-Canvas API, which in Chrome 151 is behind
 * `chrome://flags/#canvas-draw-element`. Where the API is absent the choice is kept but the
 * DOM renderer is used — so a preference set on one machine does not blank the boards on
 * another, and Settings can say which of the two is happening.
 */

export type RendererChoice = "dom" | "one-canvas" | "canvas-per-board";

export const RENDERERS: Array<{ id: RendererChoice; label: string; note: string }> = [
	{ id: "dom", label: "Documents", note: "Each board is a live document under one transform. Works everywhere." },
	{
		id: "canvas-per-board",
		label: "A canvas per board",
		note: "Each board is drawn into its own canvas and redrawn when the camera rests. Boards stay clickable.",
	},
	{
		id: "one-canvas",
		label: "One canvas",
		note: "Every board kept as a picture on one canvas. Fastest to move; nothing inside a board can be clicked.",
	},
];

const KEY = "decks.renderer";

export const isRenderer = (value: unknown): value is RendererChoice =>
	value === "dom" || value === "one-canvas" || value === "canvas-per-board";

/** The remembered choice, or the default. Storage may be absent or refuse; either is `dom`. */
export function loadRenderer(storage: Pick<Storage, "getItem"> | undefined = safeStorage()): RendererChoice {
	try {
		const raw = storage?.getItem(KEY);
		return isRenderer(raw) ? raw : "dom";
	} catch {
		return "dom";
	}
}

export function saveRenderer(choice: RendererChoice, storage: Pick<Storage, "setItem"> | undefined = safeStorage()): void {
	try {
		storage?.setItem(KEY, choice);
	} catch {
		// Private mode, or a full quota: the choice lasts for this page and no longer.
	}
}

function safeStorage(): Storage | undefined {
	try {
		return typeof localStorage === "undefined" ? undefined : localStorage;
	} catch {
		return undefined;
	}
}

/**
 * Whether this browser can draw an element into a canvas.
 *
 * One feature test rather than a user-agent check: it is the method the renderers call,
 * and a Chrome with the flag off is the same as a Safari here.
 */
export function canvasApiPresent(scope: { CanvasRenderingContext2D?: { prototype: object } } = globalThis as never): boolean {
	const proto = scope.CanvasRenderingContext2D?.prototype;
	return Boolean(proto && "drawElementImage" in proto);
}

/** What actually runs: the choice, or `dom` when the browser cannot honour it. */
export function effectiveRenderer(choice: RendererChoice, present: boolean): RendererChoice {
	if (choice === "dom") return "dom";
	return present ? choice : "dom";
}
