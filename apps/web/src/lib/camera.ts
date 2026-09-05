import type { Board, Camera } from "@decks/protocol";

/**
 * The camera, and the two conversions everything else is built on.
 *
 * `camera.x`/`y` is the world point under the centre of the viewport, not the
 * top-left. Centre-based is what makes zooming about a point and fitting a board
 * both come out as two lines instead of six — and it means a resized window keeps
 * looking at the same thing.
 */
export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 4;

/**
 * Below this, a board's frame stops taking pointer events.
 *
 * At a distance the boards are a map and dragging across one should pan; up close
 * they are documents and a click belongs to the page. 0.5 is where a board stops
 * being readable, which is the same place it stops being worth clicking into.
 */
export const INTERACT_ZOOM = 0.5;

export interface Viewport {
	width: number;
	height: number;
}

export interface Point {
	x: number;
	y: number;
}

/**
 * How much room `fit` leaves around what it framed.
 *
 * A constant 96 is a third of a phone's width on each side — the deck fitted into the
 * middle 25% of the screen, which reads as the app having failed to load rather than as
 * breathing room. So the padding is a fraction of the smaller side, capped at the 96
 * that a laptop has always had: at 1500x950 and on a tablet this is exactly 96, and it
 * only gives way where there is nothing to give.
 */
export const breathingRoom = (view: Viewport) => Math.min(96, view.width / 8, view.height / 8);

export function clampZoom(zoom: number): number {
	return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** World -> screen, in CSS pixels relative to the stage element. */
export function toScreen(camera: Camera, view: Viewport, world: { x: number; y: number }) {
	return {
		x: (world.x - camera.x) * camera.zoom + view.width / 2,
		y: (world.y - camera.y) * camera.zoom + view.height / 2,
	};
}

/** Screen -> world. The inverse, kept beside it so they cannot drift apart. */
export function toWorld(camera: Camera, view: Viewport, screen: { x: number; y: number }) {
	return {
		x: (screen.x - view.width / 2) / camera.zoom + camera.x,
		y: (screen.y - view.height / 2) / camera.zoom + camera.y,
	};
}

/**
 * Zoom by a factor, keeping the world point under the cursor under the cursor.
 *
 * The property everyone notices when it is missing: zoom that drifts means you
 * chase the thing you are zooming into across the screen.
 */
export function zoomAbout(camera: Camera, view: Viewport, screen: { x: number; y: number }, factor: number): Camera {
	const zoom = clampZoom(camera.zoom * factor);
	if (zoom === camera.zoom) return camera;
	const anchor = toWorld(camera, view, screen);
	// Solve for the camera that puts `anchor` back under `screen` at the new zoom.
	return {
		zoom,
		x: anchor.x - (screen.x - view.width / 2) / zoom,
		y: anchor.y - (screen.y - view.height / 2) / zoom,
	};
}

export function pan(camera: Camera, dx: number, dy: number): Camera {
	return { ...camera, x: camera.x - dx / camera.zoom, y: camera.y - dy / camera.zoom };
}

const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const spread = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

/**
 * Two fingers: one step of a pinch, which is a pan and a zoom at once.
 *
 * `zoomAbout` holds a point that does not move — the cursor a wheel arrives at. Two
 * fingers have no such point: the midpoint between them travels *and* the distance
 * between them changes, and both mean something. So the anchor is the world point that
 * was under the old midpoint, and the camera is solved for putting it under the new
 * one at the new zoom. Pinching with both fingers moving the same way is then a pan,
 * spreading them without moving their centre is a zoom, and doing both at once is what
 * a hand actually does — one expression rather than a pan added to a zoom.
 *
 * Called with one *step* of the gesture (the previous pair of positions, and the
 * current pair) rather than with the gesture's start. Incremental is what lets the
 * zoom clamp without the gesture losing its place: at the limit the spread stops
 * mattering and the midpoint still pans, and the fingers never end up describing a
 * camera the canvas refused to reach.
 */
export function pinchCamera(camera: Camera, view: Viewport, from: [Point, Point], to: [Point, Point]): Camera {
	const was = spread(from[0], from[1]);
	const factor = was > 0.5 ? spread(to[0], to[1]) / was : 1;
	const zoom = clampZoom(camera.zoom * factor);
	const anchor = toWorld(camera, view, mid(from[0], from[1]));
	const at = mid(to[0], to[1]);
	return {
		zoom,
		x: anchor.x - (at.x - view.width / 2) / zoom,
		y: anchor.y - (at.y - view.height / 2) / zoom,
	};
}

/**
 * The camera moved as little as it can to bring a world box into view.
 *
 * For the on-screen keyboard, which is the only thing that has ever needed it: a
 * `contenteditable` in a board is focused, the keyboard takes the bottom half of the
 * screen, and the words being typed are behind it. The room left over is the visual
 * viewport (`window.visualViewport`), which arrives here as insets in screen pixels.
 *
 * It never zooms — a caret that jumps *and* changes size loses the place twice — and
 * where the box is larger than the room, the near edges win: reading starts at the top
 * left of a paragraph, so that is the corner worth guaranteeing.
 */
export function keepVisible(
	camera: Camera,
	view: Viewport,
	box: { x: number; y: number; w: number; h: number },
	inset: { top?: number; right?: number; bottom?: number; left?: number } = {},
): Camera {
	const at = toScreen(camera, view, box);
	const width = box.w * camera.zoom;
	const height = box.h * camera.zoom;
	const left = inset.left ?? 0;
	const top = inset.top ?? 0;
	const right = view.width - (inset.right ?? 0);
	const bottom = view.height - (inset.bottom ?? 0);

	let dx = 0;
	if (at.x + width > right) dx = right - (at.x + width);
	if (at.x + dx < left) dx = left - at.x;
	let dy = 0;
	if (at.y + height > bottom) dy = bottom - (at.y + height);
	if (at.y + dy < top) dy = top - at.y;

	return dx === 0 && dy === 0 ? camera : pan(camera, dx, dy);
}

/** A camera that fits the given boxes, with room to breathe. */
export function fit(
	boxes: Array<{ x: number; y: number; w: number; h: number }>,
	view: Viewport,
	padding = breathingRoom(view),
): Camera {
	if (boxes.length === 0 || view.width === 0 || view.height === 0) return { x: 0, y: 0, zoom: 1 };
	const left = Math.min(...boxes.map((b) => b.x));
	const top = Math.min(...boxes.map((b) => b.y));
	const right = Math.max(...boxes.map((b) => b.x + b.w));
	const bottom = Math.max(...boxes.map((b) => b.y + b.h));
	const zoom = clampZoom(
		Math.min((view.width - padding * 2) / Math.max(1, right - left), (view.height - padding * 2) / Math.max(1, bottom - top)),
	);
	return { x: (left + right) / 2, y: (top + bottom) / 2, zoom };
}

/**
 * The smallest gap left between a board and the chrome beside it.
 *
 * This constant is a bug fix with a name. `fit` pads by `breathingRoom`, up to 96px a
 * side, which is right when the whole window is the canvas — and wrong once the chrome
 * insets it, because then the padding is counted *on top of* a 264px panel and a 240px
 * inspector. A board flown to on a laptop landed at 42%, below `INTERACT_ZOOM`, where a
 * board takes no pointer events: clicking the thing you had just asked to look at did
 * nothing at all.
 *
 * **The chrome is the breathing room.** So when there is chrome to subtract, all that is
 * wanted is a floor — enough that a board does not appear to touch a panel's edge.
 */
export const EDGE_FLOOR = 24;

/**
 * A camera that fits the boxes into a *region* of the viewport rather than into all of it.
 *
 * The region is the canvas column: the window minus whatever the chrome is covering, which
 * `lib/insets.ts` measures. Two things follow, and only the first is obvious.
 *
 * The zoom comes from the region, not the window — otherwise `fit` frames boards into a
 * width that includes 500px of panel and half of what it framed is behind one.
 *
 * And the camera has to be *offset*, which is the part that is easy to miss: `camera.x` is
 * the world point under the centre of the **viewport**, but what should sit at the centre
 * of the region is the content. When the region is off-centre — a left panel and no right
 * one — those are different points, and the difference is a screen distance, so it divides
 * by the zoom to become a world one.
 */
export function fitInto(
	boxes: Array<{ x: number; y: number; w: number; h: number }>,
	view: Viewport,
	region: { x: number; y: number; width: number; height: number },
): Camera {
	if (boxes.length === 0 || region.width === 0 || region.height === 0) return { x: 0, y: 0, zoom: 1 };
	const inset = region.width < view.width || region.height < view.height;
	const padding = inset ? EDGE_FLOOR : breathingRoom(view);
	const framed = fit(boxes, { width: region.width, height: region.height }, padding);
	return {
		zoom: framed.zoom,
		x: framed.x - (region.x + region.width / 2 - view.width / 2) / framed.zoom,
		y: framed.y - (region.y + region.height / 2 - view.height / 2) / framed.zoom,
	};
}

export const boxOf = (board: Board) => ({ x: board.x, y: board.y, w: board.w, h: board.h });

/**
 * Whether a camera has any of these boxes on screen.
 *
 * For deciding whether a *remembered* view is still a view of anything. A saved camera keeps
 * pointing wherever it pointed, and the boards under it can be moved, hidden or deleted while
 * you are reading another conversation — so coming back to it can mean landing on empty
 * canvas, which is the same failure as not remembering it at all.
 *
 * Any overlap counts, deliberately: a board half off the edge is a board you can see, and a
 * margin here would be a second opinion about what "looking at it" means.
 */
export function frames(camera: Camera, view: Viewport, boxes: Array<{ x: number; y: number; w: number; h: number }>): boolean {
	return boxes.some((box) => {
		const topLeft = toScreen(camera, view, { x: box.x, y: box.y });
		const bottomRight = toScreen(camera, view, { x: box.x + box.w, y: box.y + box.h });
		return bottomRight.x > 0 && topLeft.x < view.width && bottomRight.y > 0 && topLeft.y < view.height;
	});
}
