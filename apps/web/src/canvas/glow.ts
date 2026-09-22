/**
 * When a board that is news has been read on the canvas.
 *
 * A board an agent named while the person was elsewhere carries a glow on the canvas until it is
 * read (`isNews`, `chrome/dispatch-view.ts`). The dashboard's preview and the focus view already
 * count as reading; this is the third way, and the ordinary one: the person zooms in on the
 * board and rests on it. Three things have to be true at once, and stay true for a moment:
 *
 * - **Close enough to read.** Body text on a board is 17px, and at 70% it is 12px on the
 *   screen, which is where a title stops being the only thing you can make out.
 * - **Mostly on screen.** Half the board, or, for a board taller than the window, most of the
 *   window filled with it: a tall document read from its top is being read.
 * - **The camera at rest.** A board flown past at 100% was not read.
 *
 * Pure, so the rule is tested without a canvas; the frame measures and calls.
 */

/** The zoom at which a board's body text is readable. */
export const READ_ZOOM = 0.7;
/** How long the three have to hold before the board counts as read. */
export const READ_MS = 1500;
/** How much of the board has to be on screen. */
export const READ_SHARE = 0.5;
/** Or how much of the window the board has to fill, for a board bigger than it. */
export const READ_FILL = 0.6;

export interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** The share of `box` inside `within`, and the share of `within` that `box` covers, both 0 to 1. */
export function overlap(box: Box, within: Box): { share: number; fill: number } {
	const left = Math.max(box.x, within.x);
	const top = Math.max(box.y, within.y);
	const right = Math.min(box.x + box.w, within.x + within.w);
	const bottom = Math.min(box.y + box.h, within.y + within.h);
	const area = Math.max(0, right - left) * Math.max(0, bottom - top);
	const boxArea = box.w * box.h;
	const withinArea = within.w * within.h;
	return { share: boxArea > 0 ? area / boxArea : 0, fill: withinArea > 0 ? area / withinArea : 0 };
}

/** Whether a board drawn at `box` on a screen of `within` is being read, at this zoom, with the camera at rest. */
export function isRead(at: { zoom: number; moving: boolean; box: Box; within: Box }): boolean {
	if (at.moving || at.zoom < READ_ZOOM) return false;
	const { share, fill } = overlap(at.box, at.within);
	return share >= READ_SHARE || fill >= READ_FILL;
}
