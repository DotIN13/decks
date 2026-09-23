import type { Camera } from "@decks/protocol";
import { morphFrame, type WorldBox } from "../camera/morph.ts";
import { moveCamera } from "../state/camera.ts";

let flight = 0;

/**
 * Fly the camera frame by frame on the app's own curve, keeping `box` on a straight line across
 * the screen — the fall into a board's page, and the climb back out of it.
 *
 * Not the stage's glide: that one moves the camera's centre linearly, which with a tenfold
 * change of zoom swings the boards off the screen in the middle of the move. `morphFrame` keeps
 * them on a line from where they were to where they land. Each frame is an ordinary camera set,
 * the same thing a finger's pan does, and a new flight cancels the one before it.
 */
export function flyAlong(from: Camera, to: Camera, box: WorldBox, view: { width: number; height: number }, ms: number, done?: () => void): void {
	cancelAnimationFrame(flight);
	const start = performance.now();
	moveCamera(from);
	const step = (now: number) => {
		const t = Math.min(1, (now - start) / ms);
		// In and out: it neither snaps off where it was nor stops dead where it lands.
		const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
		moveCamera(morphFrame(from, to, eased, box, view));
		if (t < 1) flight = requestAnimationFrame(step);
		else done?.();
	};
	flight = requestAnimationFrame(step);
}
