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
 * the reading view's own layout — centred between the side insets, a line under the top inset,
 * never wider than the window less its air, never past life size — and it is worked out here from
 * the same numbers the stylesheet uses (`styles/canvas.css`, `.focus`).
 */
export function cameraOntoPage(
	board: WorldBox,
	view: Viewport,
	insets: { left: number; right: number; top: number },
	air = 32,
): Camera {
	const zoom = Math.min(1, Math.max(120, view.width - air * 2) / Math.max(1, board.w));
	const room = view.width - insets.left - insets.right;
	const left = insets.left + (room - board.w * zoom) / 2;
	const top = insets.top + 12;
	return {
		zoom,
		x: board.x - (left - view.width / 2) / zoom,
		y: board.y - (top - view.height / 2) / zoom,
	};
}
