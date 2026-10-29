/**
 * How much room a board's content actually takes.
 *
 * A board does not scroll: its size is a number in the file, and anything past that edge
 * is simply not drawn. Nothing complains — which is why a clipped board is usually found
 * by a reader missing a paragraph rather than by whoever wrote it. The frame showing the
 * board is the only place it is laid out, so this is measured here and sent to the server,
 * where `decks.canvas.read()` reports it and `decks.canvas.fit` acts on it.
 *
 * A board is one page that flows, so the reading is of the page: how tall its content is,
 * with the height its `<meta>` states released for the read (`documentHeight`). The stated
 * height is a floor the stage applies afterwards (`shownHeight`), never part of the reading,
 * or a board could never be fitted shorter than it once was.
 */

/**
 * How tall a board is drawn: the height the stage gives it, raised to its content's when that was
 * measured taller (`measureFrame`). The given height is a floor, never a ceiling.
 */
export function shownHeight(board: { h: number }, measured: number | undefined): number {
	return measured !== undefined && measured > board.h ? measured : board.h;
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
 * Sent with the extent so `decks.canvas.fit` can tell an agent that a board ran past one screen's
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
	if (!view || !doc.body) return { words: countWords(doc.body?.innerText ?? "") };
	return readingIn(doc.body, view, doc.documentElement.scrollWidth - doc.documentElement.clientWidth);
}

/**
 * The same reading of a card (`card.ts`), whose content is a block in the stage's own page rather than
 * a document: its words, its smallest type, how far it spills past its width, the boxes that cut off
 * their own content, and the labels in a drawing that sit on each other.
 */
export function readingOfCard(body: HTMLElement): { words: number; minFont?: number; overflowX?: number; cut?: number; overlaps?: number } {
	const view = body.ownerDocument.defaultView;
	if (!view) return { words: countWords(body.innerText ?? "") };
	return readingIn(body, view, body.scrollWidth - body.clientWidth);
}

function readingIn(body: HTMLElement, view: Window, spill: number): { words: number; minFont?: number; overflowX?: number; cut?: number; overlaps?: number } {
	const doc = body.ownerDocument;
	const words = countWords(body.innerText ?? "");
	// Content wider than the board: a table or a long line pushing past the right edge, which
	// a board cannot scroll to. Two pixels of slack for rounding.
	const overflowX = spill > 2 ? { overflowX: spill } : {};
	// Boxes that cut off their own words: a fixed-height panel that turned out too short. A
	// board cannot scroll, so what is past the edge of such a box is simply not there.
	let cutBoxes = 0;
	for (const element of body.querySelectorAll<HTMLElement>("*")) {
		if (element.scrollHeight - element.clientHeight <= 4 || !element.innerText?.trim()) continue;
		const overflow = view.getComputedStyle(element).overflowY;
		if (overflow !== "visible" && element.clientHeight > 0) cutBoxes++;
	}
	const cut = cutBoxes ? { cut: cutBoxes } : {};
	// Labels in a drawing that sit on top of each other. Nothing else here can see inside an
	// <svg>: its text does not wrap or push, so two labels placed by arithmetic collide in silence.
	const labels = [...body.querySelectorAll<SVGGraphicsElement>("svg text")]
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
	const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
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
 * The page's own height: everything in it, the body's padding, and a margin that collapsed
 * out of the last block.
 *
 * `scrollHeight` answers this, with one catch that is the reason for the lines around it:
 * `board.js` gives the body the height in the board's `<meta>` tag, or when there is none a
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
	// And the body's own margins, which a page without `board.css` keeps (8 px): the page is as tall as the body's margin box.
	const box = body.getBoundingClientRect?.();
	const below = Number.parseFloat(view?.getComputedStyle(body).marginBottom ?? "0") || 0;
	const measured = Math.max(body.scrollHeight, box ? box.bottom + (view?.scrollY ?? 0) + below : 0);
	body.style.height = held;
	body.style.minHeight = floor;
	body.style.display = display;
	return Number.isFinite(measured) && measured > 0 ? measured : undefined;
}

export function measureFrame(frame: HTMLIFrameElement | undefined): { w: number; h: number; at: number; page?: number; words?: number; minFont?: number; overflowX?: number; cut?: number; overlaps?: number } | undefined {
	const doc = frame?.contentDocument;
	const view = frame?.contentWindow as (Window & { __boardReady?: boolean }) | null | undefined;
	if (!doc || !view?.__boardReady) return undefined;
	const page = documentHeight(doc);
	if (page === undefined) return undefined;
	const h = Math.ceil(page);
	// How wide the content reaches; a board's width is still the one its `<meta>` states.
	const w = Math.ceil(Math.max(doc.documentElement.scrollWidth, doc.body?.scrollWidth ?? 0));
	// The width it was laid out at: `decks.canvas.fit` takes a height only from a layout at the width it fits at.
	const at = Math.round(doc.documentElement.clientWidth);
	return { w, h, at, page: h, ...readingOf(doc) };
}
