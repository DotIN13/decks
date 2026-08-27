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

/** A camera that fits the given boxes, with room to breathe. */
export function fit(boxes: Array<{ x: number; y: number; w: number; h: number }>, view: Viewport, padding = 96): Camera {
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

export const boxOf = (board: Board) => ({ x: board.x, y: board.y, w: board.w, h: board.h });
