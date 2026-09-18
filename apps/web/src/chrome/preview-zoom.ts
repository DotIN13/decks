/**
 * The preview's own zoom: arithmetic, kept apart from the component so it can be tested.
 *
 * The preview draws a board scaled to the panel's width inside a scroll box. Zoom is a
 * multiplier on that fitted scale, so 1 always means "the whole width of the board", whatever
 * the panel's size is, and a panel that is resized keeps the reading it had.
 */

/** Half the fitted size, up to eight times it. A preview is for reading, not for surveying. */
export const MIN_PREVIEW_ZOOM = 0.5;
export const MAX_PREVIEW_ZOOM = 8;

export function clampPreviewZoom(zoom: number): number {
	return Math.min(MAX_PREVIEW_ZOOM, Math.max(MIN_PREVIEW_ZOOM, zoom));
}

/**
 * One wheel event as a zoom factor.
 *
 * The same curve the canvas uses (`Stage`'s `wheel`): a pinch is a stream of small deltas and
 * a notch of a mouse wheel is one delta of 100 or more, so the exponential is clamped.
 */
export function wheelFactor(deltaY: number): number {
	return Math.min(1.3, Math.max(1 / 1.3, Math.exp(-deltaY / 120)));
}

/**
 * How far to scroll so the point under the cursor stays under it.
 *
 * `offset` is the cursor's distance from the drawn board's edge before the zoom, and `edge`
 * is where that edge ended up after the box was laid out at the new scale. The board point
 * under the cursor is `offset / from`; it is now drawn `offset / from * to` from the edge, and
 * the difference between where that is and where the cursor is, is the scroll.
 */
export function scrollToHold(cursor: number, offset: number, from: number, to: number, edge: number): number {
	if (from <= 0) return 0;
	return edge + (offset / from) * to - cursor;
}
