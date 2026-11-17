import type { Camera } from "@decks/protocol";
import { untrack, type Accessor } from "solid-js";
import { type Viewport } from "./camera.ts";
import { createSettled } from "./settled.ts";
import { createWheelZoom } from "./wheel-zoom.ts";
import { createGlideTo } from "./glide-to.ts";
import { createCoast } from "./coast.ts";
import { followAsked } from "./follow-asked.ts";
import { createMotion } from "./motion.ts";

/**
 * The camera of one stage: where it is, whether it is moving, and the one place that moves it.
 *
 * Everything that moves the camera comes here: a wheel or a trackpad's pinch (`wheel`), a finger or
 * a drag (`push`), a flick's coast (`coast`), a glide the app asked for (`glideTo`, and the host's
 * camera followed by the effect below). Each step is written to the page at once, by the host's
 * `place` (the world's one transform and the drawing's camera), and published to the host's camera
 * signal once a frame. What the step is never does is reach anything else in the stage: whatever
 * reads the camera reads it from here.
 *
 * Moved out of `CanvasView.tsx` whole, its comments with it, so the stage keeps the drawing and the
 * boards and asks this for the camera.
 */
export interface CameraHost {
	/** The stage's size on screen. */
	view: Accessor<Viewport>;
	/** Put the world and the drawing at this camera: the one write to the page a camera step makes (for the stage, its scroll). */
	place(camera: Camera): void;
	/** The browser has scrolled the world to this camera already: tell the drawing, and nothing else. */
	follow(camera: Camera): void;
	/** The camera moved: a press in hand runs its last step again (`editor/dom/pointer.ts`, `follow`). */
	moved(): void;
	/** The host's camera signal, set once a frame. */
	publish(camera: Camera): void;
	/** The camera the host asks for, and a glide to arrive at it by. */
	asked(): { camera: Camera; glide?: { token: number; ms: number } | undefined };
	/** Draw the drawing now: called from inside an animation frame already. */
	flush(): void;
}

export type CameraController = ReturnType<typeof createCameraController>;

export function createCameraController(host: CameraHost) {
	let localCamera = untrack(() => host.asked().camera);
	/** When the camera last moved. */
	let lastMoved = 0;
	let rafId: number | undefined;
	let pendingCamera: Camera | undefined;
	/*
	 * One glide at a time, and this is its identity.
	 *
	 * Anything that moves the camera itself — a wheel, a pinch, a drag, a key, an op — bumps the
	 * token, and the loop below stops the moment its token is not the current one. A camera the
	 * person is holding must never be argued with, and this counter is the whole of the mechanism
	 * that guarantees it.
	 */
	let glideToken = 0;
	let glideRaf: number | undefined;
	let lastGlideToken = -1;
	/**
	 * A glide the app has asked for and this file has not started yet.
	 *
	 * The camera signal and the glide request arrive in the same batch, and the boards are
	 * rendered from that batch **before** the effect below gets to start the loop — so for one
	 * pass "the camera has moved" is true and "the camera is moving" is not yet, and a board
	 * that the new camera brings into view would begin parsing its document exactly then, at
	 * the top of the flight. This closes that window: the request itself counts as movement.
	 */
	const glidePending = () => {
		const glide = host.asked().glide;
		return glide !== undefined && glide.token !== lastGlideToken;
	};
	const motion = createMotion({
		host,
	});
	const { nowScaling, nowMoving, writeTransform, setGliding, moving, gliding, panning, scaling, setPanning, stopped } = motion;



	/**
	 * Move the camera now: the body `pushCamera` has always been, given the name it deserves.
	 *
	 * A glide is **not a second way to move the camera**. It is a loop that calls this, which is why
	 * an arrival gets everything a finger already had for free: the scale settle (a zooming glide
	 * sets it for its duration, so the boards are redrawn once, at the end), the `lastMoved` stamp,
	 * and the camera signal going up once per frame, so the zoom readout
	 * ticks and `camera()` is never a lie about where the view is going.
	 */
	const write = (cam: Camera) => {
		if (cam.zoom !== localCamera.zoom) nowScaling();
		if (cam.x !== localCamera.x || cam.y !== localCamera.y || cam.zoom !== localCamera.zoom) nowMoving();
		lastMoved = performance.now();
		localCamera = cam;
		host.moved();
		/*
		 * Placed and published once a frame, however many events move the camera in it. A pinch's two
		 * fingers and a trackpad's wheel send two or three a frame, and each placed the world and gave the
		 * engine its camera (its transform, its timers, a message to the worker) for a picture the frame
		 * never showed; the frame's callback runs before the browser paints, so the one placing lands in
		 * the same frame the events did. A glide's or a coast's step is in a frame already and places at once (`placeNow`).
		 */
		pendingCamera = cam;
		if (rafId === undefined) {
			rafId = requestAnimationFrame(() => {
				rafId = undefined;
				const next = pendingCamera!;
				pendingCamera = undefined;
				writeTransform(next);
				host.publish(next);
			});
		}
	};

	const { cancelCoast, coast } = createCoast({
		write,
		get localCamera() {
			return localCamera;
		},
		get placeNow() {
			return placeNow;
		},
		host,
	});

	const cancelGlide = () => {
		cancelCoast();
		glideToken++;
		if (glideRaf !== undefined) {
			cancelAnimationFrame(glideRaf);
			glideRaf = undefined;
		}
		setGliding(false);
	};

	/**
	 * The browser scrolled the stage (a trackpad, a wheel, a finger), and the world is already where
	 * this camera puts it: the camera follows, the drawing is told, and the camera is published once
	 * a frame, as for any other step, with no transform written. A hand on the canvas wins over a
	 * glide, as it does for every gesture.
	 */
	const scrolled = (cam: Camera) => {
		if (cam.x === localCamera.x && cam.y === localCamera.y && cam.zoom === localCamera.zoom) return;
		cancelGlide();
		nowMoving();
		lastMoved = performance.now();
		localCamera = cam;
		const v = host.view();
		motion.written = { cam, width: v.width, height: v.height };
		host.follow(cam);
		host.moved();
		pendingCamera = cam;
		if (rafId === undefined) {
			rafId = requestAnimationFrame(() => {
				rafId = undefined;
				host.publish(pendingCamera!);
				pendingCamera = undefined;
			});
		}
	};

	/** Place the camera written and not yet placed now: for a caller in an animation frame that flushes the drawing itself. */
	const placeNow = () => {
		if (pendingCamera) writeTransform(pendingCamera);
	};

	/** A gesture, and the hand wins: it ends any glide before writing its own camera. */
	const push = (cam: Camera) => {
		cancelGlide();
		write(cam);
	};

	const { glideTo } = createGlideTo({
		get localCamera() {
			return localCamera;
		},
		write,
		get glideToken() {
			return glideToken;
		},
		set glideToken(next) {
			glideToken = next;
		},
		setGliding,
		placeNow,
		host,
		get glideRaf() {
			return glideRaf;
		},
		set glideRaf(next) {
			glideRaf = next;
		},
	});

	followAsked({
		host,
		get localCamera() {
			return localCamera;
		},
		set localCamera(next) {
			localCamera = next;
		},
		get lastGlideToken() {
			return lastGlideToken;
		},
		set lastGlideToken(next) {
			lastGlideToken = next;
		},
		glideTo,
		cancelGlide,
		nowScaling,
		nowMoving,
		get written() {
			return motion.written;
		},
		writeTransform,
		get rafId() {
			return rafId;
		},
		get glideRaf() {
			return glideRaf;
		},
		cancelCoast,
	});
	const { wheel } = createWheelZoom({
		push,
		get localCamera() {
			return localCamera;
		},
		host,
	});

	const { zoom, settled, rest } = createSettled({
		host,
		moving,
		gliding,
		panning,
		scaling,
		glidePending,
	});

	return {
		/** The camera as of the last step, exactly: what a gesture or a point on the screen needs. */
		now: () => localCamera,
		zoom,
		settled,
		rest,
		/** When the camera last moved. */
		lastMoved: () => lastMoved,
		moving,
		scaling,
		gliding,
		panning,
		setPanning,
		glidePending,
		write,
		push,
		glideTo,
		cancelGlide,
		scrolled,
		coast,
		cancelCoast,
		stopped,
		wheel,
	};
}
