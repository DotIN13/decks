import { knobs } from "../base/debug.ts";
import type { Camera } from "@decks/protocol";
import { createMemo, untrack, type Accessor } from "solid-js";
import type { CameraHost } from "./controller.ts";

/** What `createSettled` reads of `createCameraController` (`controller.ts`), each read when it is used. */
export interface SettledNeeds {
	readonly host: CameraHost;
	readonly moving: Accessor<boolean>;
	readonly gliding: Accessor<boolean>;
	readonly panning: Accessor<boolean>;
	readonly scaling: Accessor<boolean>;
	readonly glidePending: () => boolean;
}

export function createSettled(d: SettledNeeds) {
	/**
	 * The camera's zoom alone. What depends on the zoom only (handle sizes, the live zoom, a text
	 * editor's scale) reads this, and so hears nothing of a pan: the camera itself is a new object
	 * every frame, and reading `camera.zoom` off it re-ran each of them on every frame of a pan.
	 */
	const zoom = createMemo(() => d.host.asked().camera.zoom);

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
	const settled = createMemo<Camera>(
		() => {
			// Read so that coming to rest is heard, and the settled camera becomes the exact one then.
			d.moving();
			d.gliding();
			d.panning();
			return d.host.asked().camera;
		},
		untrack(() => d.host.asked().camera),
		{
			equals: (was, next) => {
				if (was === next) return true;
				if (was.zoom !== next.zoom) return false;
				const still = !untrack(d.moving) && !untrack(d.gliding) && !untrack(d.panning);
				if (still || knobs.exactCamera) return was.x === next.x && was.y === next.y;
				const v = untrack(d.host.view);
				return Math.abs(was.x - next.x) * was.zoom < v.width / 8 && Math.abs(was.y - next.y) * was.zoom < v.height / 8;
			},
		},
	);

	/**
	 * The camera at rest: it changes only once moving, scaling, gliding and panning are all off (and no
	 * glide is waiting to start), and then to exactly where the camera is. What is chosen from it, which
	 * cards are live (`items/awake.ts`), is chosen once a gesture ends and never during one, so a
	 * pinch mounts and unmounts nothing. `settled` changes at every step of a zoom; this does not.
	 */
	const rest = createMemo<Camera>(
		(was) => {
			const camera = d.host.asked().camera;
			const still = !d.moving() && !d.scaling() && !d.gliding() && !d.panning() && !d.glidePending();
			return still ? camera : was;
		},
		untrack(() => d.host.asked().camera),
		{ equals: (was, next) => was === next || (was.x === next.x && was.y === next.y && was.zoom === next.zoom) },
	);

	return {
		zoom,
		settled,
		rest,
	};
}
