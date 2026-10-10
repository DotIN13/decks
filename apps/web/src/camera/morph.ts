import type { Camera } from "@decks/protocol";
import { type Viewport } from "./camera.ts";

/**
 * The camera moves that fly into a board's page and back out of it.
 *
 * Pure: a box in the world and two cameras in, a camera out.
 */

export interface WorldBox {
	x: number;
	y: number;
	w: number;
	h: number;
}

/**
 * One frame of the grow: the camera `s` of the way from `from` to `to`, keeping `box` on a
 * straight line across the screen.
 *
 * The camera's ordinary glide (`between`) moves its centre linearly and its zoom geometrically,
 * which is right for a pan and wrong here: with the zoom changing tenfold, a linear centre swings
 * the boards far off the screen in the middle of the move and brings them back at the end. So
 * this interpolates what the eye follows instead — where the boards' middle is *on the screen* —
 * and solves for the camera that puts it there at this frame's zoom.
 */
export function morphFrame(from: Camera, to: Camera, s: number, box: WorldBox, view: Viewport): Camera {
	if (s <= 0) return from;
	if (s >= 1) return to;
	const middle = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
	const onScreen = (camera: Camera) => ({
		x: (middle.x - camera.x) * camera.zoom + view.width / 2,
		y: (middle.y - camera.y) * camera.zoom + view.height / 2,
	});
	const a = onScreen(from);
	const b = onScreen(to);
	/*
	 * The zoom moves in equal steps, not equal ratios. Easing the zoom by ratio while the
	 * box's middle moved in a straight line sent every *other* point on the screen along an
	 * arc — the card's corners swung out and back on the way to the canvas's. With the shift
	 * and the scale on one linear clock, every point goes straight from where it sat on the
	 * card to where it lands, and the ease in `flyAlong` is what keeps the start from lurching.
	 */
	const zoom = from.zoom + (to.zoom - from.zoom) * s;
	const at = { x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s };
	return { zoom, x: middle.x - (at.x - view.width / 2) / zoom, y: middle.y - (at.y - view.height / 2) / zoom };
}

/**
 * The camera that draws a board exactly where the reading view will put its page.
 *
 * Opening a board is the camera arriving and the page taking over on the last frame, so the last
 * frame has to *be* the page: the same scale, the same place on the screen. The page's place is
 * the reading view's own layout (`styles/canvas.css`, `.focus`): the work area right of the board
 * list, edge to edge, under the view's header, and as wide as the room up to twice life size. A
 * board that fills itself has no header of the app's above it (its own bar is the header), so it
 * lands at the top; it is laid out again at the work area's size, so the landing is its width.
 */
export function cameraOntoPage(
	board: WorldBox,
	view: Viewport,
	insets: { left: number; right: number; top: number },
	o: { fills?: boolean; header?: number } = {},
): Camera {
	const room = Math.max(120, view.width - insets.left - insets.right);
	const zoom = o.fills ? room / Math.max(1, board.w) : Math.min(2, room / Math.max(1, board.w));
	const left = insets.left;
	const top = o.fills ? 0 : (o.header ?? FOCUS_HEADER);
	return {
		zoom,
		x: board.x - (left - view.width / 2) / zoom,
		y: board.y - (top - view.height / 2) / zoom,
	};
}

/** The focus view's header row, in screen pixels (`.focus-bar` in `styles/canvas.css`). */
export const FOCUS_HEADER = 52;
