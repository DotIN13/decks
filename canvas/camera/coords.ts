/**
 * Every conversion between coordinate spaces, in one file.
 *
 * The only place outside `camera.ts` that multiplies or divides by a zoom; each function says its
 * direction in its name, and a point and a delta convert differently (below).
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

