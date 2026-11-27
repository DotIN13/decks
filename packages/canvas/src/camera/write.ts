import type { Camera } from "@decks/protocol";
import { createMotion } from "./motion.ts";
import { type CameraHost } from "./controller.ts";

/** What `createCameraWrite` reads of `createCameraController` (`controller.ts`). */
export interface CameraWriteNeeds {
	localCamera: Camera;
	readonly nowScaling: () => void;
	readonly nowMoving: () => void;
	lastMoved: number;
	readonly host: CameraHost;
	pendingCamera: Camera | undefined;
	rafId: number | undefined;
	readonly writeTransform: (cam: Camera) => void;
	readonly cancelGlide: () => void;
	readonly motion: ReturnType<typeof createMotion>;
}

/** Writing the camera: a step taken at once on this page, sent to the host once a frame, and what the browser's own scroll reports. */
export function createCameraWrite(d: CameraWriteNeeds) {
	/**
	 * Move the camera now: the body `pushCamera` has always been, given the name it deserves.
	 *
	 * A glide is **not a second way to move the camera**. It is a loop that calls this, which is why
	 * an arrival gets everything a finger already had for free: the scale settle (a zooming glide
	 * sets it for its duration, so the cards are redrawn once, at the end), the `lastMoved` stamp,
	 * and the camera signal going up once per frame, so the zoom readout
	 * ticks and `camera()` is never a lie about where the view is going.
	 */
	const write = (cam: Camera) => {
		if (cam.zoom !== d.localCamera.zoom) d.nowScaling();
		if (cam.x !== d.localCamera.x || cam.y !== d.localCamera.y || cam.zoom !== d.localCamera.zoom) d.nowMoving();
		d.lastMoved = performance.now();
		d.localCamera = cam;
		d.host.moved();
		/*
		 * Placed and published once a frame, however many events move the camera in it. A pinch's two
		 * fingers and a trackpad's wheel send two or three a frame, and each placed the world and gave the
		 * engine its camera (its transform, its timers, a message to the worker) for a picture the frame
		 * never showed; the frame's callback runs before the browser paints, so the one placing lands in
		 * the same frame the events did. A glide's or a coast's step is in a frame already and places at once (`placeNow`).
		 */
		d.pendingCamera = cam;
		if (d.rafId === undefined) {
			d.rafId = requestAnimationFrame(() => {
				d.rafId = undefined;
				const next = d.pendingCamera!;
				d.pendingCamera = undefined;
				d.writeTransform(next);
				d.host.publish(next);
			});
		}
	};

	/**
	 * The browser scrolled the canvas (a trackpad, a wheel, a finger), and the world is already where
	 * this camera puts it: the camera follows, the drawing is told, and the camera is published once
	 * a frame, as for any other step, with no transform written. A hand on the canvas wins over a
	 * glide, as it does for every gesture.
	 */
	const scrolled = (cam: Camera) => {
		if (cam.x === d.localCamera.x && cam.y === d.localCamera.y && cam.zoom === d.localCamera.zoom) return;
		d.cancelGlide();
		d.nowMoving();
		d.lastMoved = performance.now();
		d.localCamera = cam;
		const v = d.host.view();
		d.motion.written = { cam, width: v.width, height: v.height };
		d.host.follow(cam);
		d.host.moved();
		d.pendingCamera = cam;
		if (d.rafId === undefined) {
			d.rafId = requestAnimationFrame(() => {
				d.rafId = undefined;
				d.host.publish(d.pendingCamera!);
				d.pendingCamera = undefined;
			});
		}
	};

	/** Place the camera written and not yet placed now: for a caller in an animation frame that flushes the drawing itself. */
	const placeNow = () => {
		if (d.pendingCamera) d.writeTransform(d.pendingCamera);
	};

	/** A gesture, and the hand wins: it ends any glide before writing its own camera. */
	const push = (cam: Camera) => {
		d.cancelGlide();
		write(cam);
	};

	return {
		write,
		placeNow,
		push,
		scrolled,
	};
}
