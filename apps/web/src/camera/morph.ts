import type { Camera } from "@decks/protocol";
import { type Viewport } from "./camera.ts";

/**
 * The two cameras the open-a-canvas animation runs between.
 *
 * A canvas card is already a small picture of the canvas, so the canvas can start *exactly
 * where the card was* and grow: the first frame puts every board inside the card's rectangle,
 * the last frame is the canvas's own view, and the glide between them is the camera's ordinary
 * one — geometric in zoom, ease-out in time — so nothing new has to be tuned and nothing
 * cross-fades. Going back is the same pair the other way round.
 *
 * Pure: a rectangle on the screen and a box in the world in, a camera out.
 */

export interface ScreenRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

export interface WorldBox {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** The boards' bounds in world coordinates, or nothing for an empty canvas. */
export function boundsOf(boards: readonly WorldBox[]): WorldBox | undefined {
	if (boards.length === 0) return undefined;
	const left = Math.min(...boards.map((board) => board.x));
	const top = Math.min(...boards.map((board) => board.y));
	const right = Math.max(...boards.map((board) => board.x + board.w));
	const bottom = Math.max(...boards.map((board) => board.y + board.h));
	return { x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * The camera that draws `box` inside `card`, a card measured on the screen.
 *
 * `stage` is where the stage element sits on the same screen, because a camera is relative to
 * the stage's own middle and a card's rectangle is relative to the window. The card's picture
 * strip is a little smaller than the card, so `inset` keeps the boards off its border.
 */
export function cameraInto(box: WorldBox, card: ScreenRect, stage: ScreenRect, inset = 8): Camera {
	const zoom = Math.max(0.01, Math.min((card.width - inset * 2) / Math.max(1, box.w), (card.height - inset * 2) / Math.max(1, box.h)));
	const middle = { x: card.left + card.width / 2 - stage.left, y: card.top + card.height / 2 - stage.top };
	const view: Viewport = { width: stage.width, height: stage.height };
	return {
		zoom,
		x: box.x + box.w / 2 - (middle.x - view.width / 2) / zoom,
		y: box.y + box.h / 2 - (middle.y - view.height / 2) / zoom,
	};
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
	const zoom = from.zoom * Math.pow(to.zoom / from.zoom, s);
	const at = { x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s };
	return { zoom, x: middle.x - (at.x - view.width / 2) / zoom, y: middle.y - (at.y - view.height / 2) / zoom };
}
