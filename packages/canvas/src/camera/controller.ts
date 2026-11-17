import type { Camera } from "@decks/protocol";
import { untrack, type Accessor } from "solid-js";
import { type Viewport } from "./camera.ts";
import { createSettled } from "./settled.ts";
import { createWheelZoom } from "./wheel-zoom.ts";
import { createGlideTo } from "./glide-to.ts";
import { createCoast } from "./coast.ts";
import { followAsked } from "./follow-asked.ts";
import { createMotion } from "./motion.ts";
import { createCameraWrite } from "./write.ts";

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



	const { write, placeNow, push, scrolled } = createCameraWrite({
		nowScaling, nowMoving, host, writeTransform, motion,
		get localCamera() { return localCamera; },
		set localCamera(next) { localCamera = next; },
		get lastMoved() { return lastMoved; },
		set lastMoved(next) { lastMoved = next; },
		get pendingCamera() { return pendingCamera; },
		set pendingCamera(next) { pendingCamera = next; },
		get rafId() { return rafId; },
		set rafId(next) { rafId = next; },
		get cancelGlide() { return cancelGlide; },
	});

	const { cancelCoast, coast } = createCoast({
		write,
		get localCamera() { return localCamera; },
		get placeNow() { return placeNow; },
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

	const { glideTo } = createGlideTo({
		write, setGliding, placeNow, host,
		get localCamera() { return localCamera; },
		get glideToken() { return glideToken; },
		set glideToken(next) { glideToken = next; },
		get glideRaf() { return glideRaf; },
		set glideRaf(next) { glideRaf = next; },
	});

	followAsked({
		host, glideTo, cancelGlide, nowScaling, nowMoving, writeTransform, cancelCoast,
		get localCamera() { return localCamera; },
		set localCamera(next) { localCamera = next; },
		get lastGlideToken() { return lastGlideToken; },
		set lastGlideToken(next) { lastGlideToken = next; },
		get written() { return motion.written; },
		get rafId() { return rafId; },
		get glideRaf() { return glideRaf; },
	});
	const { wheel } = createWheelZoom({
		push,
		get localCamera() { return localCamera; },
		host,
	});

	const { zoom, settled, rest } = createSettled({ host, moving, gliding, panning, scaling, glidePending });

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
