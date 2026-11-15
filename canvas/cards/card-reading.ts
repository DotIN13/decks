/**
 * How a card reads (`card.ts`), for `decks.canvas.fit`: its words, its smallest type, how far it
 * spills past its width, the boxes that cut off their own content, and the labels in a drawing that
 * sit on each other. A card is laid out only where it is drawn, so it is read there and sent to the
 * harness, where `decks.canvas.read()` reports it and `decks.canvas.fit` acts on it.
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

/**
 * The same reading of a card (`card.ts`), whose content is a block in the stage's own page rather than
 * a document: its words, its smallest type, how far it spills past its width, the boxes that cut off
 * their own content, and the labels in a drawing that sit on each other.
 */
export function readingOfCard(body: HTMLElement): { words: number; minFont?: number; overflowX?: number; cut?: number; overlaps?: number } {
	const view = body.ownerDocument.defaultView;
	if (!view) return { words: countWords(body.innerText ?? "") };
	return readingOfBody(body, view, body.scrollWidth - body.clientWidth);
}

/** The reading of any block of content in a page, `spill` being how far it reaches past its width. */
export function readingOfBody(body: HTMLElement, view: Window, spill: number): { words: number; minFont?: number; overflowX?: number; cut?: number; overlaps?: number } {
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
