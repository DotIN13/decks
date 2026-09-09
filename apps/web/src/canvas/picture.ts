/**
 * The arithmetic behind drawing a board into a canvas, with no canvas in it.
 *
 * Both canvas renderers (`lib/renderer.ts`) draw a board's document with
 * `drawElementImage`, and both have the same two questions to answer first: how many pixels
 * should the picture have, and does the picture there already need drawing again. Those are
 * plain functions of the board's size, the zoom and the screen, so they live here where
 * `picture.test.ts` can ask them without a browser.
 *
 * ### Sized to what is on screen
 *
 * A board is drawn at the number of device pixels it currently occupies — its world size
 * times the zoom times the pixel ratio — because that is the one size at which the picture
 * is neither blurry nor wasteful. Drawn larger it is memory spent on detail the screen
 * cannot show; drawn smaller it is a soft picture. A pinch changes that size on every step,
 * which is exactly why nothing is redrawn during one: the picture is stretched by the
 * compositor until the camera rests, and drawn once at the new size then.
 *
 * ### Capped
 *
 * A 1200×900 board at zoom 4 on a 2× screen would want 9600×7200 pixels, which is 276MB of
 * backing store for one board. The cap keeps a picture under a few thousand pixels a side;
 * past it a board is drawn at the cap and stretched, which at that zoom is a board larger
 * than the window with only a part of it visible anyway.
 */

/** The most pixels a board's picture may have along either side. */
export const MAX_SIDE = 4096;

export interface PictureSize {
	/** Backing-store pixels. */
	w: number;
	h: number;
}

/**
 * How large to draw a board's picture for the zoom it is seen at. Always at least a pixel.
 *
 * `cap` is one number for both sides, or a box the picture has to fit — the one-canvas
 * renderer captures pictures through a canvas of its own and cannot take one larger than it.
 *
 * How many pixels, and nothing about the transform to draw with: that is `drawScale`, which
 * has to be measured off the element rather than worked out from the board and the zoom.
 */
export function pictureSize(board: { w: number; h: number }, zoom: number, dpr: number, cap: number | { w: number; h: number } = MAX_SIDE): PictureSize {
	const capW = typeof cap === "number" ? cap : cap.w;
	const capH = typeof cap === "number" ? cap : cap.h;
	const wantW = Math.ceil(board.w * zoom * dpr);
	const wantH = Math.ceil(board.h * zoom * dpr);
	const over = Math.max(wantW / Math.max(1, capW), wantH / Math.max(1, capH), 1);
	const w = Math.max(1, Math.round(wantW / over));
	const h = Math.max(1, Math.round(wantH / over));
	return { w, h };
}

/**
 * Whether a picture drawn at one size should be drawn again for another.
 *
 * Not "is it different": a pixel of rounding is not worth a document paint, and a picture a
 * little larger than the screen needs is still sharp. So a redraw is asked for when the
 * picture is *smaller* than the screen wants by more than the tolerance — soft — or larger
 * by more than a factor that makes the memory worth reclaiming.
 */
export function needsRedraw(have: { w: number; h: number } | undefined, want: { w: number; h: number }, tolerance = 0.02): boolean {
	if (!have) return true;
	const ratio = Math.max(want.w / Math.max(1, have.w), want.h / Math.max(1, have.h));
	if (ratio > 1 + tolerance) return true;
	// Four times the pixels the screen needs is memory, not sharpness.
	if (ratio < 0.5) return true;
	return false;
}

/**
 * How many backing pixels a canvas has for each CSS pixel it is shown at.
 *
 * **This is the number `drawElementImage` draws in.** An element does not arrive in the
 * canvas's pixels and does not arrive in CSS pixels: it arrives at its own size on screen
 * times this ratio. On an ordinary canvas at the pixel ratio it is 2 on a retina screen; on
 * a canvas given more pixels than it is shown at, it is more.
 *
 * `undefined` for a canvas that has not been laid out, where the answer would be a division
 * by zero dressed up as a measurement.
 */
export function canvasPixelRatio(canvas: HTMLCanvasElement): { x: number; y: number } | undefined {
	const box = canvas.getBoundingClientRect();
	if (!(box.width > 0) || !(box.height > 0)) return undefined;
	return { x: canvas.width / box.width, y: canvas.height / box.height };
}

/**
 * The transform to draw an element with, so that it lands in `target` pixels.
 *
 * `element` is its size on screen (`getBoundingClientRect()`) and `ratio` is the canvas's own
 * pixels per CSS pixel (`canvasPixelRatio`) — the element arrives at the product of the two,
 * and this is what is needed to bring that to the size wanted.
 *
 * Both renderers had this wrong, in opposite directions, because both worked it out from the
 * board and the zoom instead of measuring it:
 *
 * - a canvas per board scaled by the zoom, which the canvas's own mapping already carries,
 *   and drew the board 11% small — 36% small once zoomed into;
 * - one canvas scaled by the zoom times the pixel ratio, right on a 1× screen and twice the
 *   picture on a 2× one, where it kept the top-left quarter of every board.
 */
export function drawScale(target: { w: number; h: number }, element: { width: number; height: number }, ratio: { x: number; y: number }): { x: number; y: number } | undefined {
	const arrivesW = element.width * ratio.x;
	const arrivesH = element.height * ratio.y;
	if (!(arrivesW > 0) || !(arrivesH > 0) || !(target.w > 0) || !(target.h > 0)) return undefined;
	return { x: target.w / arrivesW, y: target.h / arrivesH };
}

/**
 * The bits of Chrome's HTML-in-Canvas API this app calls, typed here because TypeScript's
 * DOM library does not know them yet. `elementContext` is the feature test in action: it
 * hands back a context only when the method is there to call.
 */
export interface ElementDrawingContext extends CanvasRenderingContext2D {
	drawElementImage(element: Element, dx: number, dy: number): void;
}

export interface PaintEvent extends Event {
	/** The drawable children whose content changed since the last rendering update. */
	changedElements?: Element[];
}

export function elementContext(canvas: HTMLCanvasElement): ElementDrawingContext | undefined {
	const ctx = canvas.getContext("2d") as ElementDrawingContext | null;
	return ctx && typeof ctx.drawElementImage === "function" ? ctx : undefined;
}

/**
 * What a board frame is given by the stage when a canvas renderer is on.
 *
 * The queue spreads settle redraws over frames for every board at once. The rest is only
 * for the one-canvas renderer, where a board's document lives in the stage's darkroom
 * canvas rather than in the board's own box: `darkroom` is where to put it, `changed` is how
 * to say its picture is stale, and `has` says whether the stage is still holding a picture
 * for a board whose document has been let go.
 */
export interface PictureHost {
	queue: import("./redraw-queue.ts").RedrawQueue;
	darkroom?: HTMLCanvasElement;
	changed(path: string): void;
	has(path: string): boolean;
}
