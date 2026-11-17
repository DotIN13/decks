import type { Setter } from "solid-js";
import type { Camera } from "@decks/protocol";
import { between } from "./camera.ts";
import { springCurve } from "./spring.ts";
import type { CameraHost } from "./controller.ts";

/** What `createGlideTo` reads of `createCameraController` (`controller.ts`), each read when it is used. */
export interface GlideToNeeds {
	readonly localCamera: Camera;
	readonly write: (cam: Camera) => void;
	glideToken: number;
	readonly setGliding: Setter<boolean>;
	readonly placeNow: () => void;
	readonly host: CameraHost;
	glideRaf: number | undefined;
}

export function createGlideTo(d: GlideToNeeds) {
	/**
	 * Arrive at `to` over `ms`, from wherever the camera is *now*.
	 *
	 * From the pixels rather than from the previous target, so two moves in a row read as a change
	 * of mind rather than as the view travelling backwards to a place it never went. The last frame
	 * writes `to` itself, not `between(from, to, 1)` — see the note on `between` about what `a +
	 * (b - a) * 1` does to a fit.
	 */
	const glideTo = (to: Camera, ms: number) => {
		const from = d.localCamera;
		if (from.x === to.x && from.y === to.y && from.zoom === to.zoom) {
			d.write(to);
			return;
		}
		const mine = ++d.glideToken;
		const at = performance.now();
		d.setGliding(true);
		/*
		 * `performance.now()`, not the timestamp `requestAnimationFrame` hands the callback.
		 *
		 * They are different clocks, and `at` above is a `performance.now()`. The frame's own
		 * timestamp is when the frame *started*, which is routinely **before** the moment the press
		 * that started this glide was handled — a press arrives during a frame. So `now - at` came out
		 * negative on the first frame, the number was clamped to zero, and the move spent its first
		 * frames re-drawing where it already was: on a loaded machine that cost 20% of the travel,
		 * measured — the camera sat at the start for 50ms and then finished late. It was invisible in
		 * a frame-by-frame assertion, which is happy to see *some* intermediate value, and obvious in
		 * a chart of the curve the samples were supposed to be on.
		 */
		// iOS's spring, no bounce: away at once, settling into place (`app/spring.ts`).
		const curve = springCurve(ms);
		const step = () => {
			if (mine !== d.glideToken) return;
			const t = Math.min(1, (performance.now() - at) / ms);
			d.write(t >= 1 ? to : between(from, to, curve(t)));
			// In an animation frame already: the world is placed and the drawing drawn now, in this frame, not at the next.
			d.placeNow();
			d.host.flush();
			if (t >= 1) {
				d.glideRaf = undefined;
				d.setGliding(false);
				return;
			}
			d.glideRaf = requestAnimationFrame(step);
		};
		d.glideRaf = requestAnimationFrame(step);
	};

	return {
		glideTo,
	};
}
