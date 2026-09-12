/**
 * Every conversion between coordinate spaces, in one file.
 *
 * There were nine of these written by hand across four files, and four of the bugs recorded
 * in this codebase's comments came from them: a pinch that walked the canvas 90 px sideways
 * and down (the stage's offset subtracted twice), a 60 px drag that moved the camera 30
 * (board pixels used where screen pixels were meant), a title bar 88 px tall at 27% zoom
 * (`24 / zoom` where only part of the value scales), and a forced layout on every event of a
 * gesture (a conversion that measured the DOM instead of asking the camera).
 *
 * They are not nine problems. Three of them crossed a boundary that is the identity — see
 * `stagePoint` — and five are the same three sums written five times. This file is those
 * three sums, named so the direction is in the name, and **the only place outside
 * `camera.ts` allowed to multiply or divide by a zoom.**
 *
 * ### The spaces
 *
 * - **stage** — pixels from the top-left of the stage element. The camera works in these,
 *   and because the stage *is* the viewport (`stagePoint`), they are also client pixels.
 * - **board** — pixels inside a board's own document. A board's iframe knows nothing of the
 *   camera, so these are the board's own layout coordinates, unscaled.
 * - **world** — what the boards are laid out in. `camera.ts` owns the trip to and from here.
 *
 * ### Why a point converts and a delta converts differently
 *
 * A point needs the frame's position *and* its scale; a delta needs only the scale. Writing
 * them as one function is what produces the bug where an offset is added to a difference.
 */

declare const space: unique symbol;
type In<S extends string> = { readonly [space]?: S };

/** A position. The space is part of the type, so the compiler refuses a mix-up. */
export type Point<S extends string> = { x: number; y: number } & In<S>;
/** A movement. Not a position: no origin is involved, so only the scale applies. */
export type Delta<S extends string> = { dx: number; dy: number } & In<S>;

/**
 * A pointer event's position, in stage pixels — **which is the event's own `clientX`.**
 *
 * The stage element is the viewport, and that is a property of the stylesheet rather than a
 * hope: `#root` has `margin: 0`, `.app` is `position: relative`, and `.work` and `.stage` are
 * both `position: absolute; inset: 0`, with no transform on any ancestor (the only transforms
 * in the app are on `.dock`, `.side` and a palette button, none of them above the stage).
 *
 * So the conversion across this boundary has always been adding zero — at the cost of a
 * cached `getBoundingClientRect`, and three places to get the sign wrong. `checkStageOrigin`
 * is what stops that silently ceasing to be true.
 */
export const stagePoint = (event: { clientX: number; clientY: number }): Point<"stage"> => ({
	x: event.clientX,
	y: event.clientY,
});

/**
 * Warn, once, if the stage is not where `stagePoint` assumes.
 *
 * Called from the stage's own mount. The day someone insets the stage — a title bar returns,
 * a border appears — every gesture would be off by that much, and silently: nothing throws,
 * the canvas simply drifts under the cursor. A measurement at mount costs one layout read and
 * turns that into a sentence in the console.
 */
export function checkStageOrigin(stage: Element): void {
	const rect = stage.getBoundingClientRect();
	if (Math.abs(rect.left) < 0.5 && Math.abs(rect.top) < 0.5) return;
	console.warn(
		`The stage is at (${Math.round(rect.left)}, ${Math.round(rect.top)}), not the viewport's origin. ` +
			"Every pointer position on the canvas is now off by that much — see `stagePoint` in camera/coords.ts.",
	);
}

/**
 * Where a board's frame is on the stage, and how large it is drawn.
 *
 * From the camera, never from `getBoundingClientRect`: a rect read on a frame is a forced
 * layout of the parent document, and during a pinch every title bar has just had its width
 * rewritten, so each finger's event paid for laying all of them out again. The camera is
 * written synchronously in the same handler that dispatched the event, so asking it gives the
 * same answer the layout would have.
 */
export interface FrameAt {
	/** The frame's left edge, in stage pixels. */
	left: number;
	/** Its top edge, in stage pixels. */
	top: number;
	/** The camera's zoom: one board pixel is this many stage pixels. */
	scale: number;
}

/** A position inside a board → the same position on the stage. */
export const pointFromBoard = (at: FrameAt, x: number, y: number): Point<"stage"> => ({
	x: at.left + x * at.scale,
	y: at.top + y * at.scale,
});

/**
 * A movement measured in board pixels → the same movement in stage pixels.
 *
 * No offset: a difference has no origin, and adding one is the bug this being a separate
 * function prevents.
 */
export const deltaFromBoard = (at: FrameAt, dx: number, dy: number): Delta<"stage"> => ({
	dx: dx * at.scale,
	dy: dy * at.scale,
});

/**
 * A movement in stage pixels → board pixels. The inverse, kept beside it so the two cannot
 * drift apart — for scrolling a box inside a board, which is laid out in board pixels.
 */
export const deltaToBoard = (at: FrameAt, dx: number, dy: number): Delta<"board"> => ({
	dx: dx / at.scale,
	dy: dy / at.scale,
});
