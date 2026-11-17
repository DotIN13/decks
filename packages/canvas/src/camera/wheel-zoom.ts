import type { Camera } from "@decks/protocol";
import { pan, zoomAbout } from "./camera.ts";
import type { CameraHost } from "./controller.ts";

/** What `createWheelZoom` reads of `createCameraController` (`controller.ts`), each read when it is used. */
export interface WheelZoomNeeds {
	readonly push: (cam: Camera) => void;
	readonly localCamera: Camera;
	readonly host: CameraHost;
}

export function createWheelZoom(d: WheelZoomNeeds) {
	/**
	 * Scroll units per e-fold of zoom: smaller zooms faster (see `wheel`). A trackpad pinch, which
	 * Chrome reports as `ctrlKey` without ⌘, has its own; every other zoom (⌘ with a wheel, a mouse
	 * that scrolls in small steps) keeps the one it had.
	 */
	const PINCH_TRAVEL = 64;

	const WHEEL_TRAVEL = 80;

	const wheel = (gesture: { x: number; y: number; deltaX: number; deltaY: number; zooming: boolean; pinch?: boolean }) => {
		const travel = gesture.pinch ? PINCH_TRAVEL : WHEEL_TRAVEL;
		if (gesture.zooming) {
			/*
			 * A pinch arrives as a stream of small deltas and a ⌘-wheel notch as one
			 * delta of 100 or more, so the exponential is clamped: without it, the
			 * pinch is right and one notch of the wheel jumps 2.7x.
			 *
			 * The divisor is how far a finger has to travel for a given zoom, and it is the
			 * pinch's alone: a wheel notch is past the clamp at any of these numbers, so
			 * changing it moves the trackpad and leaves the mouse where it was. It has been
			 * turned five times, each time because a Mac trackpad felt slow — 300 barely doubled
			 * the zoom across a whole pinch, 200 was still short, 120 (about 3.8×) a little short,
			 * 100 (about 5×) still slow, 80 (about 7.4×) asked to be faster, 60 (about 14×) a little
			 * too fast. At 64 that pinch is about 12× (`PINCH_TRAVEL`).
			 */
			const factor = Math.min(1.3, Math.max(1 / 1.3, Math.exp(-gesture.deltaY / travel)));
			d.push(zoomAbout(d.localCamera, d.host.view(), { x: gesture.x, y: gesture.y }, factor));
			return;
		}
		d.push(pan(d.localCamera, -gesture.deltaX, -gesture.deltaY));
	};

	return {
		wheel,
	};
}
