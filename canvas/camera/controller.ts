import { createSignal, onCleanup, untrack } from "solid-js";
import { controllerApi } from "./controller-api.ts";
import { cancelCoast, followAsked } from "./controller-motion.ts";
import type { CameraHost, CameraRun } from "./controller-write.ts";

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

export type CameraController = ReturnType<typeof createCameraController>;

export function createCameraController(host: CameraHost) {
	const [panning, setPanning] = createSignal(false);
	const [scaling, setScaling] = createSignal(false);
	const [moving, setMoving] = createSignal(false);
	const [gliding, setGliding] = createSignal(false);
	const c: CameraRun = {
		host,
		localCamera: untrack(() => host.asked().camera),
		lastMoved: 0,
		glideToken: 0,
		lastGlideToken: -1,
		panning,
		setPanning,
		scaling,
		setScaling,
		moving,
		setMoving,
		gliding,
		setGliding,
	};
	onCleanup(() => clearTimeout(c.moveSettle));
	onCleanup(() => clearTimeout(c.scaleSettle));
	followAsked(c);
	onCleanup(() => {
		if (c.rafId !== undefined) cancelAnimationFrame(c.rafId);
		if (c.glideRaf !== undefined) cancelAnimationFrame(c.glideRaf);
		cancelCoast(c);
	});
	return controllerApi(c);
}
