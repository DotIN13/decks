import { countWords, readingOfBody } from "@decks/canvas/card-reading";

/**
 * How much room a page takes (a document, or an old board on a friend's canvas), measured for
 * `decks.canvas.fit` by the server's own Chromium when no canvas has (`../measure.ts`,
 * `server/stage/shots.ts`). A card is not measured here: `measure.ts` mounts it as the canvas does.
 *
 * A page flows, so the reading is of the page: how tall its content is, with the height its
 * `<meta>` states released for the read (`documentHeight`).
 */

/** How the page reads: its words, its smallest type, its spill, cut boxes and labels on each other (`card-reading.ts`). */
export function readingOf(doc: Document): { words: number; minFont?: number; overflowX?: number; cut?: number; overlaps?: number } {
	const view = doc.defaultView;
	if (!view || !doc.body) return { words: countWords(doc.body?.innerText ?? "") };
	return readingOfBody(doc.body, view, doc.documentElement.scrollWidth - doc.documentElement.clientWidth);
}

/**
 * The page's own height: everything in it, the body's padding, and a margin that collapsed
 * out of the last block.
 *
 * `scrollHeight` answers this, with one catch that is the reason for the lines around it:
 * `card.js` gives the body the height in the board's `<meta>` tag, or when there is none a
 * `min-height` of the frame itself (`100vh`), so asking a body that is already that tall how
 * tall it is answers the tag or the frame rather than the content, and the board could then
 * never shrink. A new board starts at the frame's size, so every board an agent wrote came
 * out at least that tall, and was squeezed and fitted back by hand. Releasing both for the
 * read is what makes it a measurement. It is synchronous — nothing paints in between — and
 * it happens once per revision, not once per frame.
 *
 * The height only. A board's width is the author's, stated in its `<meta>` tag, and is
 * never taken from a measurement.
 */
export function documentHeight(doc: Document): number | undefined {
	const body = doc.body as HTMLElement | null;
	if (!body) return undefined;
	const held = body.style.height;
	const floor = body.style.minHeight;
	const display = body.style.display;
	body.style.height = "auto";
	body.style.minHeight = "0";
	/*
	 * A first or last block's margin collapses through a plain block body and lies outside it, where
	 * `scrollHeight` does not count it: a board whose first row had a 48 px top margin was measured
	 * 48 px short, and its page scrolled by that much under a wheel meant to pan the canvas. As its
	 * own formatting context the body keeps those margins inside it, at the same total height.
	 */
	const view = doc.defaultView;
	if (view?.getComputedStyle(body).display === "block") body.style.display = "flow-root";
	// And the body's own margins, which a page without `card.css` keeps (8 px): the page is as tall as the body's margin box.
	const box = body.getBoundingClientRect?.();
	const below = Number.parseFloat(view?.getComputedStyle(body).marginBottom ?? "0") || 0;
	const measured = Math.max(body.scrollHeight, box ? box.bottom + (view?.scrollY ?? 0) + below : 0);
	body.style.height = held;
	body.style.minHeight = floor;
	body.style.display = display;
	return Number.isFinite(measured) && measured > 0 ? measured : undefined;
}

/**
 * Measure the document inside a frame, once it has finished mounting: `__cardReady` is the page's
 * own signal that markdown, maths, diagrams and embeds have all rendered, and before it this answers
 * `undefined` and the caller waits.
 */
export function measureFrame(frame: HTMLIFrameElement | undefined): { w: number; h: number; at: number; page?: number; words?: number; minFont?: number; overflowX?: number; cut?: number; overlaps?: number } | undefined {
	const doc = frame?.contentDocument;
	const view = frame?.contentWindow as (Window & { __cardReady?: boolean }) | null | undefined;
	if (!doc || !view?.__cardReady) return undefined;
	const page = documentHeight(doc);
	if (page === undefined) return undefined;
	const h = Math.ceil(page);
	// How wide the content reaches; a board's width is still the one its `<meta>` states.
	const w = Math.ceil(Math.max(doc.documentElement.scrollWidth, doc.body?.scrollWidth ?? 0));
	// The width it was laid out at: `decks.canvas.fit` takes a height only from a layout at the width it fits at.
	const at = Math.round(doc.documentElement.clientWidth);
	return { w, h, at, page: h, ...readingOf(doc) };
}
