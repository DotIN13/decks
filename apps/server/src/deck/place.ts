import type { Camera } from "@decks/protocol";

/**
 * Where a board goes when nobody said where.
 *
 * One rule, in one place, because the app has six ways for a board to arrive on a canvas —
 * an agent's `stage.newBoard`, `stage.show`, the ＋ in the corner, a board picked out of the
 * rail, the dashboard's "open on canvas", a mirror — and each of them used to fall through to
 * the deck's own auto-layout: rows of three, starting below **every board that stage had ever
 * been given a place for**. On a deck of 900 boards that is a column a million pixels tall, so
 * a new board landed forty screens below the one you were reading and nothing moved to show it.
 *
 * The rule here is: **a board joins the canvas where you are looking, and clear of what is
 * already on it.** The anchor is the middle of the canvas view, so the board arrives in front
 * of the person; `freeSpot` then pushes it off anything already there, which makes "near the
 * boards you have" and "where you are looking" the same answer in the usual case, where the
 * view is framing the boards.
 *
 * Nothing here reads or writes state. The caller is `agents/session.ts`, which owns both the
 * places and the list of what is on the canvas.
 */

export interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** Space left between boards. The same number `deck/loader.ts` lays its fallback rows on. */
export const GUTTER = 160;

/**
 * The canvas when the browser has not said how big it is.
 *
 * Only reached for an agent nobody has ever watched — a camera is reported with the room it
 * has beside it (`app/camera-report.ts`) — and it decides nothing but how far from the anchor
 * a board may sit and still count as visible.
 */
const ASSUMED_VIEW = { width: 1440, height: 900 };

const touching = (a: Box, b: Box, gap: number): boolean =>
	a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/** Do two rectangles share any area at all? */
const overlaps = (a: Box, b: Box): boolean => touching(a, b, 0);

/** The one rectangle that holds all of them. */
export function bounds(boxes: readonly Box[]): Box | undefined {
	if (boxes.length === 0) return undefined;
	const left = Math.min(...boxes.map((box) => box.x));
	const top = Math.min(...boxes.map((box) => box.y));
	const right = Math.max(...boxes.map((box) => box.x + box.w));
	const bottom = Math.max(...boxes.map((box) => box.y + box.h));
	return { x: left, y: top, w: right - left, h: bottom - top };
}

/** The world rectangle a camera can see, in board coordinates. */
export function viewBox(camera?: Camera): Box | undefined {
	if (!camera || !Number.isFinite(camera.zoom) || camera.zoom <= 0) return undefined;
	const w = (camera.width ?? ASSUMED_VIEW.width) / camera.zoom;
	const h = (camera.height ?? ASSUMED_VIEW.height) / camera.zoom;
	// `camera.x`/`y` is the world point under the middle of the canvas, not its corner.
	return { x: camera.x - w / 2, y: camera.y - h / 2, w, h };
}

/**
 * The nearest free spot to an anchor, for a board of this size.
 *
 * The candidates are the anchor itself and the edges of the boards already on the canvas — to
 * the right of each, below each, to the left of each — so a board that cannot land where it was
 * aimed lands *tidily* beside something rather than nudged a few pixels clear of it.
 *
 * The nearest of those to the anchor wins, which works out as **the short way round whatever is
 * in the way**: past the side of a board that is taller than it is wide, underneath one that is
 * wider than it is tall. That is what keeps a canvas compact instead of growing in one direction.
 * Equal distances go to the right, and when every candidate is taken the board goes to the right
 * of everything.
 */
export function freeSpot(anchor: { x: number; y: number }, size: { w: number; h: number }, occupied: readonly Box[]): { x: number; y: number } {
	const middle = (spot: { x: number; y: number }) => ({ x: spot.x + size.w / 2, y: spot.y + size.h / 2 });
	const aimed = { x: Math.round(anchor.x - size.w / 2), y: Math.round(anchor.y - size.h / 2) };
	const candidates = [
		aimed,
		...occupied.flatMap((box) => [
			{ x: box.x + box.w + GUTTER, y: box.y },
			{ x: box.x, y: box.y + box.h + GUTTER },
			{ x: box.x - size.w - GUTTER, y: box.y },
		]),
	];
	const free = candidates.filter((spot) => !occupied.some((box) => touching({ ...spot, ...size }, box, GUTTER / 2)));
	let best: { x: number; y: number } | undefined;
	let closest = Infinity;
	for (const spot of free) {
		const from = middle(spot);
		const distance = Math.hypot(from.x - anchor.x, from.y - anchor.y);
		if (distance < closest) {
			closest = distance;
			best = spot;
		}
	}
	if (best) return { x: Math.round(best.x), y: Math.round(best.y) };
	const cluster = bounds(occupied);
	return cluster ? { x: Math.round(cluster.x + cluster.w + GUTTER), y: Math.round(cluster.y) } : aimed;
}

/**
 * Where a board joins a canvas: the middle of the view, clear of what is already on it.
 *
 * With no camera to go by — a background agent nobody has opened — it is the right-hand edge of
 * the boards that are there, and for the first board on an empty canvas it is the origin, which
 * is where an empty canvas is looking anyway.
 */
export function joinSpot(size: { w: number; h: number }, onCanvas: readonly Box[], camera?: Camera): { x: number; y: number } {
	const view = viewBox(camera);
	const cluster = bounds(onCanvas);
	const anchor = view
		? { x: view.x + view.w / 2, y: view.y + view.h / 2 }
		: cluster
			? { x: cluster.x + cluster.w + GUTTER + size.w / 2, y: cluster.y + size.h / 2 }
			: { x: size.w / 2, y: size.h / 2 };
	return freeSpot(anchor, size, onCanvas);
}

/**
 * Is the place a board already has near enough to keep when it joins the canvas?
 *
 * Yes when it is somewhere the person can see, and yes when it sits within a board's length of
 * the boards on the canvas — which is what makes hiding a board and playing it again put it back
 * in its own hole rather than at the end of the row. No when it is neither: that is a board still
 * carrying a place from the old deck-wide auto-layout, arriving a million pixels from anything.
 *
 * **An empty canvas keeps it too**, which is the case that has to be argued for rather than
 * assumed. There is nothing there to be near and so nothing to be far from, and a place is
 * somebody's decision — a drag, a drop, a deck laid out on purpose. Moving it here was worse than
 * useless in both directions: clearing the canvas and playing one board back moved it, and every
 * arrangement was one clear-and-replay from being rebuilt around wherever the camera happened to
 * be. Nothing is lost by keeping it, because the camera arrives on a board you asked for.
 */
export function keepsPlace(box: Box, onCanvas: readonly Box[], camera?: Camera): boolean {
	const cluster = bounds(onCanvas);
	if (!cluster) return true;
	const view = viewBox(camera);
	if (view && overlaps(box, view)) return true;
	const reach = GUTTER + Math.max(box.w, box.h);
	return touching(box, cluster, reach);
}
