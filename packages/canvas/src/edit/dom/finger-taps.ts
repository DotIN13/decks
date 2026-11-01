import { TAP_WINDOW_MS } from "./touch-rules.ts";

/**
 * Two or three fingers tapped together: undo and redo on a touch screen, as iOS has them. Fingers
 * that land within the window of the first, none of which travels past the slop, and that all lift
 * within `tapMs` of the first landing are one tap of as many fingers as were down at once. A finger
 * that lands late, wanders or stays is a pinch, a pan or a hold, and nothing here.
 */
export interface FingerTaps {
	down(id: number, x: number, y: number, now: number): void;
	move(id: number, x: number, y: number): void;
	/** The finger lifted: the tap's finger count once the last lifts, or undefined. */
	up(id: number, now: number): number | undefined;
	cancel(): void;
}

export function createFingerTaps(options: { windowMs?: number; slopPx?: number; tapMs?: number } = {}): FingerTaps {
	const windowMs = options.windowMs ?? TAP_WINDOW_MS;
	const slopPx = options.slopPx ?? 10;
	const tapMs = options.tapMs ?? 350;
	const fingers = new Map<number, { x: number; y: number }>();
	let first: number | undefined;
	let peak = 0;
	let spoiled = false;
	const reset = () => {
		fingers.clear();
		first = undefined;
		peak = 0;
		spoiled = false;
	};
	return {
		down(id, x, y, now) {
			if (first === undefined) first = now;
			else if (now - first > windowMs) spoiled = true;
			fingers.set(id, { x, y });
			peak = Math.max(peak, fingers.size);
		},
		move(id, x, y) {
			const was = fingers.get(id);
			if (was && Math.hypot(x - was.x, y - was.y) > slopPx) spoiled = true;
		},
		up(id, now) {
			if (!fingers.has(id)) return undefined;
			fingers.delete(id);
			if (first !== undefined && now - first > tapMs) spoiled = true;
			if (fingers.size > 0) return undefined;
			const count = peak;
			const clean = !spoiled;
			reset();
			return clean && count >= 2 ? count : undefined;
		},
		cancel: reset,
	};
}
