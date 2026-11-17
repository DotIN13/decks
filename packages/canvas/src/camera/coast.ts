import type { Camera } from "@decks/protocol";
import { pan } from "./camera.ts";
import { coastStep } from "./touch.ts";
import type { CameraHost } from "./controller.ts";

/** What `createCoast` reads of `createCameraController` (`controller.ts`), each read when it is used. */
export interface CoastNeeds {
	readonly write: (cam: Camera) => void;
	readonly localCamera: Camera;
	readonly placeNow: () => void;
	readonly host: CameraHost;
}

export function createCoast(d: CoastNeeds) {
	/*
	 * The coast after a thrown one-finger pan (`coastStep`, `touch.ts`). Its own frame, not a
	 * glide's: a glide is the app moving the camera somewhere, and a finger landing must stop
	 * a coast without also stopping that. Anything else that moves the camera stops it too,
	 * because every one of those goes through `cancelGlide`.
	 */
	let coastRaf: number | undefined;

	const cancelCoast = () => {
		if (coastRaf === undefined) return;
		cancelAnimationFrame(coastRaf);
		coastRaf = undefined;
	};

	const coast = (start: { vx: number; vy: number }) => {
		cancelCoast();
		let v = start;
		let last = performance.now();
		const frame = () => {
			const now = performance.now();
			const step = coastStep(v, now - last);
			last = now;
			v = step.v;
			d.write(pan(d.localCamera, step.dx, step.dy));
			// In an animation frame already: the world is placed and the drawing drawn now, in this frame, not at the next.
			d.placeNow();
			d.host.flush();
			if (Math.hypot(v.vx, v.vy) < 0.01) {
				coastRaf = undefined;
				return;
			}
			coastRaf = requestAnimationFrame(frame);
		};
		coastRaf = requestAnimationFrame(frame);
	};

	return {
		cancelCoast,
		coast,
	};
}
