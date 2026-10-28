import type { Camera } from "@decks/protocol";
import type { Viewport } from "./camera.ts";

/**
 * The stage as a scroll area: the camera's position is the stage's scroll position.
 *
 * A pan is the browser scrolling the stage, on its compositor, with nothing of ours in the frame:
 * the pages, the drawing's sheet and everything else in the world move because the world sits in
 * the scrolled content. Our code hears of it afterwards, from the scroll event, and reads the
 * camera back from the scroll (`Stage.tsx`, `camera/controller.ts`, `scrolled`).
 *
 * The content is a spacer `SIZE` wide and tall, and the world is placed in it at an origin: the
 * canvas point drawn at the middle of the spacer, `MIDDLE`. The zoom stays the world's own scale.
 * The camera's centre is on screen at the window's middle, so
 *
 *     scrollLeft = MIDDLE + (camera.x − origin.x) × zoom − width / 2
 *
 * and the same down. A canvas has no edges and a scroll area does, so while the camera rests within
 * `RECENTRE_WINDOWS` windows of an edge, the origin moves to the camera and the scroll back to the
 * middle, in one task, which changes nothing on screen (`recentre`).
 *
 * 200,000 px rather than more: the world is placed `MIDDLE` from the content's corner, and at
 * 100,000 a 32-bit float still places it to a sixty-fourth of a pixel.
 */
export const SIZE = 200_000;
export const MIDDLE = SIZE / 2;
/** How many windows from an edge the scroll may come to rest before the area is recentred. */
export const RECENTRE_WINDOWS = 3;

export interface Origin {
	x: number;
	y: number;
}

/** The scroll position that shows `camera`. */
export function scrollFor(camera: Camera, origin: Origin, view: Viewport): { left: number; top: number } {
	return {
		left: MIDDLE + (camera.x - origin.x) * camera.zoom - view.width / 2,
		top: MIDDLE + (camera.y - origin.y) * camera.zoom - view.height / 2,
	};
}

/** The camera a scroll position shows, at `zoom`: `scrollFor` turned round. */
export function cameraFor(scroll: { left: number; top: number }, origin: Origin, zoom: number, view: Viewport): Camera {
	return {
		x: origin.x + (scroll.left + view.width / 2 - MIDDLE) / zoom,
		y: origin.y + (scroll.top + view.height / 2 - MIDDLE) / zoom,
		zoom,
	};
}

/**
 * The origin that shows `camera` at a scroll position that does not move: how a pinch changes the
 * view without setting the scroll, which on an iPad lays out and scrolls the whole area at each step.
 */
export function originFor(camera: Camera, scroll: { left: number; top: number }, view: Viewport): Origin {
	return {
		x: camera.x - (scroll.left + view.width / 2 - MIDDLE) / camera.zoom,
		y: camera.y - (scroll.top + view.height / 2 - MIDDLE) / camera.zoom,
	};
}

/** The world's transform: the origin at the spacer's middle, at the zoom. */
export function worldTransform(origin: Origin, zoom: number): string {
	return `translate(${MIDDLE}px, ${MIDDLE}px) scale(${zoom}) translate(${-origin.x}px, ${-origin.y}px)`;
}

/** Whether a scroll at rest is near enough an edge that the area should be recentred. */
export function nearEdge(scroll: { left: number; top: number }, view: Viewport): boolean {
	const mx = view.width * RECENTRE_WINDOWS;
	const my = view.height * RECENTRE_WINDOWS;
	return scroll.left < mx || scroll.top < my || scroll.left > SIZE - view.width - mx || scroll.top > SIZE - view.height - my;
}
