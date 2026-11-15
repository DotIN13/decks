import type { Camera } from "@decks/protocol-old";
import { createMemo, untrack } from "solid-js";
import { knobs } from "../debug.ts";
import { cancelCoast, cancelGlide, coast, glideTo, push, scrolled, wheel } from "./controller-motion.ts";
import { glidePending, stopped, write, type CameraRun } from "./controller-write.ts";

/**
 * The camera as everything that is not glued to the screen should see it: the camera itself,
 * except that a pan at one zoom reaches it only once it has gone an eighth of the window since it
 * last did, and exactly once the camera has stopped. Nothing a board shows changes with a pan (the
 * world's transform moves its page), and what is decided from the camera (which boards are near
 * the screen, which may load a page, where a pill goes) looks a whole window past the screen or
 * waits for a rest anyway: so each pan step reaches none of it. A zoom reaches it at once.
 *
 * `knobs.exactCamera` hands every camera through, for measuring.
 */
function settledCamera(c: CameraRun) {
	const { host, moving, gliding, panning } = c;
	return createMemo<Camera>(
		() => {
			// Read so that coming to rest is heard, and the settled camera becomes the exact one then.
			moving();
			gliding();
			panning();
			return host.asked().camera;
		},
		untrack(() => host.asked().camera),
		{
			equals: (was, next) => {
				if (was === next) return true;
				if (was.zoom !== next.zoom) return false;
				const still = !untrack(moving) && !untrack(gliding) && !untrack(panning);
				if (still || knobs.exactCamera) return was.x === next.x && was.y === next.y;
				const v = untrack(host.view);
				return Math.abs(was.x - next.x) * was.zoom < v.width / 8 && Math.abs(was.y - next.y) * was.zoom < v.height / 8;
			},
		},
	);
}

/**
 * The camera at rest: it changes only once moving, scaling, gliding and panning are all off (and no
 * glide is waiting to start), and then to exactly where the camera is. What is chosen from it, which
 * cards are live (`items/awake.ts`), is chosen once a gesture ends and never during one, so a
 * pinch mounts and unmounts nothing. `settled` changes at every step of a zoom; this does not.
 */
function restCamera(c: CameraRun) {
	return createMemo<Camera>(
		(was) => {
			const camera = c.host.asked().camera;
			const still = !c.moving() && !c.scaling() && !c.gliding() && !c.panning() && !glidePending(c);
			return still ? camera : was;
		},
		untrack(() => c.host.asked().camera),
		{ equals: (was, next) => was === next || (was.x === next.x && was.y === next.y && was.zoom === next.zoom) },
	);
}

/** The controller `createCameraController` answers, over the state it holds. */
export function controllerApi(c: CameraRun) {
	/**
	 * The camera's zoom alone. What depends on the zoom only (handle sizes, the live zoom, a text
	 * editor's scale) reads this, and so hears nothing of a pan: the camera itself is a new object
	 * every frame, and reading `camera.zoom` off it re-ran each of them on every frame of a pan.
	 */
	const zoom = createMemo(() => c.host.asked().camera.zoom);
	const settled = settledCamera(c);
	const rest = restCamera(c);
	return {
		/** The camera as of the last step, exactly: what a gesture or a point on the screen needs. */
		now: () => c.localCamera,
		zoom,
		settled,
		rest,
		/** When the camera last moved. */
		lastMoved: () => c.lastMoved,
		moving: c.moving,
		scaling: c.scaling,
		gliding: c.gliding,
		panning: c.panning,
		setPanning: c.setPanning,
		glidePending: () => glidePending(c),
		write: (cam: Camera) => write(c, cam),
		push: (cam: Camera) => push(c, cam),
		glideTo: (to: Camera, ms: number) => glideTo(c, to, ms),
		cancelGlide: () => cancelGlide(c),
		scrolled: (cam: Camera) => scrolled(c, cam),
		coast: (start: { vx: number; vy: number }) => coast(c, start),
		cancelCoast: () => cancelCoast(c),
		stopped: () => stopped(c),
		wheel: (gesture: Parameters<typeof wheel>[1]) => wheel(c, gesture),
	};
}
