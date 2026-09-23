/**
 * One fact, shared by the two files that listen inside a board's document.
 *
 * `frame-gestures.ts` moves the camera when a finger over a board means the canvas.
 * `Editor.ts` is meanwhile holding a pending tap for that same finger, because on touch
 * selecting is a tap and only a tap — and it has no way to tell the two apart on its own.
 * Distance travelled is the obvious test and it is wrong here: in-frame coordinates *are*
 * board coordinates, and a pan drags the board along under the finger, so a 60px pan
 * measured 8px of movement and every pan across a board ended by selecting whatever it
 * had started on. Screen coordinates would answer it, and `screenX` is 0 for a
 * synthesised touch, so the browser checks could not see the bug either.
 *
 * So the fact is passed instead of inferred: keyed by the board's document, because that
 * is what both sides already hold, and a timestamp rather than a flag because a flag has
 * to be cleared by somebody and there is no moment that belongs to both files.
 */

const moved = new WeakMap<Document, number>();

/** The camera was moved by a gesture in this board's document, just now. */
export function noteCameraMove(doc: Document): void {
	moved.set(doc, performance.now());
}

/** Whether the camera has moved since the given moment — i.e. this was a pan. */
export function cameraMovedSince(doc: Document, since: number): boolean {
	return (moved.get(doc) ?? Number.NEGATIVE_INFINITY) >= since;
}
