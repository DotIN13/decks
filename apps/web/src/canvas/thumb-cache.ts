import type { Board } from "@decks/protocol";
import { createSignal } from "solid-js";

/**
 * A picture of a board, kept so the next look at it costs nothing.
 *
 * A thumbnail is the board itself, scaled down (DESIGN §6.6) — which is why one is never
 * stale and never a job that has to finish before you can see your deck. The cost is a live
 * document per thumbnail, rebuilt every time you scroll back to it, and on a deck of two
 * dozen that is two dozen documents parsing `board.css`, `board.js`, KaTeX and Mermaid.
 *
 * So the board is photographed once and the photograph is kept. **The freshness property
 * survives because the key is `path@rev`**: an edit is a new revision, so an edited board
 * misses the cache and goes back to being a live document until its next picture is taken.
 * Nothing has to be invalidated, because nothing is ever wrong — a picture that no longer
 * matches its board is simply a key nobody asks for.
 *
 * Used in the all-canvases modal only. The context panel keeps live documents on purpose:
 * those are the boards an agent is rewriting right now, so a photograph of one would be out
 * of date before it landed and re-taken on every revision.
 *
 * ### Why it can afford to be synchronous work at all
 *
 * `modern-screenshot` clones the tree, copies computed styles onto the clone, serialises it
 * into an SVG `foreignObject` and rasterises that — all on the main thread. Left to its
 * defaults that is 330–650ms per board with half-second frame gaps, which is a freeze, not a
 * hitch. Two settings make it affordable, both measured:
 *
 * - **`includeStyleProperties`.** It copies ~340 computed properties onto every cloned node
 *   by default, and a KaTeX block is hundreds of nodes. The shortlist below is what a
 *   thumbnail actually needs — box, colour, type, transforms — and it is 2.2× faster with no
 *   visible difference on any board in the example deck, diagram and maths and PDF embed
 *   included.
 * - **The worker.** Worthless on its own (1.8KB that only does `fetch`, against a cost that
 *   was 95% main-thread), and worth ~25% once the styles are trimmed, because fetching is
 *   then a real share of a smaller total.
 *
 * Together: 1893ms → 874ms of wall time across four boards, 1792ms → 685ms of main-thread
 * blocking, and the worst frame gap from 539ms down to 163ms. That last number is the one
 * that matters — it is what makes `requestIdleCallback` able to absorb this at all.
 */

/**
 * The properties a thumbnail needs, instead of every property there is.
 *
 * A shortlist is a fidelity risk, and the risk is a board using something not on it. What is
 * here covers position, box, paint, type, the two layout systems and the transforms boards
 * position themselves with; `fill` and `stroke` are for the SVG that Mermaid and hand-drawn
 * diagrams produce. `thumbs.mjs` asserts a picture still has ink in it, which is what a
 * missing property would take away.
 */
const STYLE_PROPERTIES = [
	"position", "display", "left", "top", "right", "bottom", "width", "height",
	"margin", "padding", "border", "border-radius", "box-shadow", "box-sizing",
	"background", "background-color", "background-image", "background-size", "background-position",
	"color", "opacity", "visibility", "overflow",
	"font", "font-family", "font-size", "font-weight", "font-style", "line-height",
	"letter-spacing", "text-align", "text-decoration", "text-transform", "white-space", "word-break",
	"flex", "flex-direction", "flex-wrap", "align-items", "justify-content", "gap",
	"grid-template-columns", "grid-template-rows",
	"transform", "transform-origin", "translate", "scale",
	"fill", "stroke", "stroke-width", "list-style", "vertical-align",
];

/**
 * How many pictures to keep.
 *
 * Object URLs, so the bytes are the browser's rather than the JS heap's — but they are still
 * bytes, and a deck worked in for a week would otherwise accumulate one per revision of every
 * board. Sixty is several screens of the widest grid.
 */
const LIMIT = 60;

/** How wide a picture is drawn. The rail draws at 150; a little more survives a retina grid. */
const WIDTH = 300;

const key = (board: Board) => `${board.path}@${board.rev}`;

/** `path@rev` → object URL, in insertion order so the oldest is the one to drop. */
const pictures = new Map<string, string>();
/**
 * One signal for the whole cache.
 *
 * Coarse on purpose: a thumbnail has to re-render when *its* picture lands, and a signal per
 * entry would be a signal per board per revision. Every mounted thumbnail re-reads on any
 * insert, and there are dozens of them, not thousands.
 */
const [taken, setTaken] = createSignal(0);

/** The picture of this exact revision, if there is one. Reactive. */
export function picture(board: Board): string | undefined {
	taken();
	return pictures.get(key(board));
}

/** Whether this board has any picture at all — for the check, and for deciding to take one. */
export function hasPicture(board: Board): boolean {
	return pictures.has(key(board));
}

function keep(board: Board, url: string): void {
	/*
	 * One picture per board, not one per revision.
	 *
	 * An agent editing a board produces a revision per write, so keeping every one would
	 * fill the cache with pictures of a board as it briefly was. The newest is the only one
	 * anybody will ask for.
	 */
	for (const existing of [...pictures.keys()]) {
		if (existing.startsWith(`${board.path}@`)) {
			URL.revokeObjectURL(pictures.get(existing)!);
			pictures.delete(existing);
		}
	}
	pictures.set(key(board), url);
	while (pictures.size > LIMIT) {
		const oldest = pictures.keys().next().value;
		if (oldest === undefined) break;
		URL.revokeObjectURL(pictures.get(oldest)!);
		pictures.delete(oldest);
	}
	setTaken((count) => count + 1);
}

/** Everything, released. For a check that wants to prove the cache is doing the work. */
export function forgetPictures(): void {
	for (const url of pictures.values()) URL.revokeObjectURL(url);
	pictures.clear();
	setTaken((count) => count + 1);
}

/**
 * One worker, for the app's lifetime.
 *
 * `?url` rather than an import: the file has to be *fetched* by the worker constructor, not
 * bundled into the main chunk. Vite emits it as an asset and hands back its address.
 */
let workerUrl: string | undefined;
/** The library, fetched the first time a picture is wanted rather than on every page load. */
let library: Promise<typeof import("modern-screenshot")> | undefined;

/**
 * Pictures are taken one at a time, deck-wide.
 *
 * Two at once is two 160ms blocks of main thread back to back, which is a 320ms gap however
 * it is scheduled. A queue of promises is the whole of the scheduling: the idle callback that
 * asked for a picture waits its turn.
 */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Photograph a board's live document.
 *
 * Resolves when the picture is in the cache, or immediately if there is nothing to do. Never
 * rejects: a thumbnail that cannot be photographed is a thumbnail that stays a live document,
 * which is the behaviour there has always been.
 */
export function takePicture(frame: HTMLIFrameElement, board: Board): Promise<void> {
	if (hasPicture(board)) return Promise.resolve();
	const run = queue.then(async () => {
		if (hasPicture(board)) return;
		const body = frame.contentDocument?.body;
		if (!body) return;
		try {
			library ??= import("modern-screenshot");
			workerUrl ??= (await import("modern-screenshot/worker?url")).default;
			const { domToBlob } = await library;
			/*
			 * Fonts first. `board.js` renders maths and diagrams after the document loads, and a
			 * picture taken before the fonts are in place is a picture of the fallback metrics.
			 */
			await frame.contentDocument?.fonts?.ready;
			const blob = await domToBlob(body, {
				width: board.w,
				height: board.h,
				scale: WIDTH / Math.max(1, board.w),
				includeStyleProperties: STYLE_PROPERTIES,
				workerUrl,
				workerNumber: 1,
				backgroundColor: getComputedStyle(body).backgroundColor || undefined,
			});
			if (blob.size > 0) keep(board, URL.createObjectURL(blob));
		} catch {
			/*
			 * A board that will not photograph keeps its live document, which is what every
			 * board had before this existed. Nothing here is worth a notice: the user did not
			 * ask for a picture and cannot act on its absence.
			 */
		}
	});
	queue = run;
	return run;
}
