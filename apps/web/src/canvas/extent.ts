/**
 * How much room a board's content actually takes.
 *
 * A board does not scroll: its size is a number in the file, and anything past that edge
 * is simply not drawn. Nothing complains — which is why a clipped board is usually found
 * by a reader missing a paragraph rather than by whoever wrote it. The frame showing the
 * board is the only place it is laid out, so this is measured here and sent to the server,
 * where `stage.boards()` reports it and `stage.fit` acts on it.
 *
 * The reading is deliberately of the *components* — the direct children carrying a
 * `data-id` — and not of `scrollWidth`. A board's body is sized to the meta, backgrounds
 * and decorations paint to that edge, and `scrollWidth` therefore answers "how big is the
 * board" on every board ever written. The components answer the question that was asked.
 */

export interface Box {
	right: number;
	bottom: number;
	width: number;
	height: number;
}

/** The bottom-right corner of everything, or nothing at all for an empty board. */
export function contentExtent(boxes: Box[]): { w: number; h: number } | undefined {
	let w = 0;
	let h = 0;
	let seen = false;
	for (const box of boxes) {
		// A hidden component measures 0×0 at the origin; counting it would make every
		// board's extent at least the origin, which is not a fact about anything.
		if (box.width <= 0 || box.height <= 0) continue;
		seen = true;
		if (box.right > w) w = box.right;
		if (box.bottom > h) h = box.bottom;
	}
	return seen ? { w: Math.ceil(w), h: Math.ceil(h) } : undefined;
}

/**
 * Measure the document inside a frame, if there is one and it has finished mounting.
 *
 * `__boardReady` is the board's own signal that markdown, maths, diagrams and embeds have
 * all rendered. Measuring before it is measuring the wrong document — the numbers are
 * plausible, which is the problem — so this answers `undefined` and the caller waits.
 */
/**
 * How much there is to read, and how small the smallest of it is.
 *
 * Sent with the extent so `stage.fit` can tell an agent that a board ran past one screen's
 * worth of words, or set type nobody can read once the board is fitted to a window, without
 * the agent taking a screenshot to find out. Visible text only, and only elements that hold
 * words of their own, so a wrapper's inherited size is not counted for its children.
 */
/**
 * Words, for a budget that has to mean the same thing in Chinese as in English.
 *
 * Splitting on spaces counts a Chinese sentence as one word, so a board written in Chinese
 * read as a fifth of its length and was never told it was long. Han, kana and hangul are
 * counted by character and divided by 1.6, which is about how many characters carry what an
 * English word does; everything else is counted by spaces as before.
 */
export function countWords(text: string): number {
	const cjk = text.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g)?.length ?? 0;
	const rest = text.replace(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g, " ").match(/[\p{L}\p{N}][^\s]*/gu)?.length ?? 0;
	return rest + Math.round(cjk / 1.6);
}

export function readingOf(doc: Document): { words: number; minFont?: number; overflowX?: number; cut?: number; overlaps?: number } {
	const view = doc.defaultView;
	const words = countWords(doc.body?.innerText ?? "");
	if (!view || !doc.body) return { words };
	// Content wider than the board: a table or a long line pushing past the right edge, which
	// a board cannot scroll to. Two pixels of slack for rounding.
	const spill = doc.documentElement.scrollWidth - doc.documentElement.clientWidth;
	const overflowX = spill > 2 ? { overflowX: spill } : {};
	// Boxes that cut off their own words: a fixed-height panel that turned out too short. A
	// board cannot scroll, so what is past the edge of such a box is simply not there.
	let cutBoxes = 0;
	for (const element of doc.body.querySelectorAll<HTMLElement>("*")) {
		if (element.scrollHeight - element.clientHeight <= 4 || !element.innerText?.trim()) continue;
		const overflow = view.getComputedStyle(element).overflowY;
		if (overflow !== "visible" && element.clientHeight > 0) cutBoxes++;
	}
	const cut = cutBoxes ? { cut: cutBoxes } : {};
	// Labels in a drawing that sit on top of each other. Nothing else here can see inside an
	// <svg>: its text does not wrap or push, so two labels placed by arithmetic collide in silence.
	const labels = [...doc.body.querySelectorAll<SVGGraphicsElement>("svg text")]
		.filter((label) => label.textContent?.trim())
		.map((label) => label.getBoundingClientRect())
		.filter((box) => box.width > 0 && box.height > 0);
	let collisions = 0;
	for (let a = 0; a < labels.length && a < 200; a++) {
		for (let b = a + 1; b < labels.length && b < 200; b++) {
			const one = labels[a] as DOMRect;
			const two = labels[b] as DOMRect;
			const across = Math.min(one.right, two.right) - Math.max(one.left, two.left);
			const down = Math.min(one.bottom, two.bottom) - Math.max(one.top, two.top);
			if (across > 3 && down > 3) collisions++;
		}
	}
	const overlaps = collisions ? { overlaps: collisions } : {};
	let minFont: number | undefined;
	const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		if (!node.nodeValue || !/\S{2,}/.test(node.nodeValue)) continue;
		const element = node.parentElement;
		if (!element || element.closest("script, style, svg [data-ink-layer]")) continue;
		const rect = element.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) continue;
		const size = Number.parseFloat(view.getComputedStyle(element).fontSize);
		if (Number.isFinite(size) && (minFont === undefined || size < minFont)) minFont = size;
	}
	return minFont === undefined ? { words, ...overflowX, ...cut, ...overlaps } : { words, minFont: Math.round(minFont * 10) / 10, ...overflowX, ...cut, ...overlaps };
}

/**
 * A flow board's height is its **document's**, which is taller than the boxes in it.
 *
 * A component board is a canvas of boxes, and the reading above is exactly right for it:
 * the body has no padding, and the room around the work is in each box's own coordinates.
 * A *page* — a flow board that brings its own design — is a document, and two pieces of it
 * are below every `[data-id]` there is: the body's own bottom padding, where a page keeps
 * its margins, and a bottom margin that collapsed out of the last block and now sits under
 * it. Neither is in any component's box. Left out, the canvas gives the board a rectangle
 * shorter than the document it is showing, and the page scrolls inside it.
 *
 * `scrollHeight` answers this, with one catch that is the reason for the two lines around
 * it: `board.js` gives the body the height in the board's `<meta>` tag, so asking a body
 * that is already that tall how tall it is answers the tag rather than the content, and the
 * board could then never shrink. Releasing the height for the read is what makes it a
 * measurement. It is synchronous — nothing paints in between — and it happens once per
 * revision, not once per frame.
 *
 * The height only. A board's width is the author's, stated in its `<meta>` tag, and is
 * never taken from a measurement.
 */
export function documentHeight(doc: Document): number | undefined {
	const body = doc.body as HTMLElement | null;
	if (!body) return undefined;
	const held = body.style.height;
	body.style.height = "auto";
	const measured = body.scrollHeight;
	body.style.height = held;
	return Number.isFinite(measured) && measured > 0 ? measured : undefined;
}

export function measureFrame(frame: HTMLIFrameElement | undefined): { w: number; h: number; words?: number; minFont?: number; overflowX?: number; cut?: number; overlaps?: number } | undefined {
	const doc = frame?.contentDocument;
	const view = frame?.contentWindow as (Window & { __boardReady?: boolean }) | null | undefined;
	if (!doc || !view?.__boardReady) return undefined;
	const boxes: Box[] = [];
	for (const element of doc.querySelectorAll<HTMLElement>("body > [data-id]")) {
		const rect = element.getBoundingClientRect();
		// The frame is not scrolled — a board cannot scroll — so viewport coordinates and
		// board coordinates are the same thing.
		boxes.push({ right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height });
	}
	const extent = contentExtent(boxes);
	if (!extent) return undefined;
	const page = doc.body?.classList.contains("flow") ? documentHeight(doc) : undefined;
	return { w: extent.w, h: Math.max(extent.h, Math.ceil(page ?? 0)), ...readingOf(doc) };
}
