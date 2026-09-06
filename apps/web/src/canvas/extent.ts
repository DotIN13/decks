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
export function measureFrame(frame: HTMLIFrameElement | undefined): { w: number; h: number } | undefined {
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
	return contentExtent(boxes);
}
