import type { Touches } from "../camera/touch.ts";
import { type Finger, type TouchStep } from "../camera/touch.ts";
import { KeptTouches, type FingersNeeds } from "./fingers.ts";

/** What `createFingerPress` reads of `createFingers` (`fingers.ts`), each read when it is used. */
export interface FingerPressNeeds {
	readonly carried: Set<number>;
	readonly touch: (phase: "down" | "move" | "up", finger: Finger) => TouchStep;
	readonly fingerOf: (event: PointerEvent) => Finger;
	readonly keptTouches: KeptTouches;
	readonly outer: FingersNeeds;
	readonly touches: Touches;
	caught: boolean;
}

export function createFingerPress(d: FingerPressNeeds) {
	const onTouchMove = (event: PointerEvent) => {
		if (!d.carried.has(event.pointerId)) return;
		d.touch("move", d.fingerOf(event));
	};

	const onTouchEnd = (event: PointerEvent) => {
		if (!d.carried.has(event.pointerId)) return;
		d.carried.delete(event.pointerId);
		d.keptTouches.delete(event.pointerId);
		d.touch("up", d.fingerOf(event));
		if (d.carried.size > 0) return;
		window.removeEventListener("pointermove", onTouchMove);
		window.removeEventListener("pointerup", onTouchEnd);
		window.removeEventListener("pointercancel", onTouchEnd);
	};

	/** Hand back every finger this document is carrying, wherever each one got to. */
	const releaseCarried = () => {
		for (const id of [...d.carried]) {
			d.carried.delete(id);
			d.touch("up", { id, x: 0, y: 0 });
		}
	};

	const beginTouch = (event: PointerEvent) => {
		// A tap on bare canvas clears the selection, exactly as a click does. Decided on
		// the way down rather than on the way up: a pan that starts on empty canvas is not
		// a gesture that wants to keep a component selected either.
		if (d.outer.onCanvas(event.target)) d.outer.props.onSelect(undefined);
		/*
		 * The browser's own word for "nothing else is down": the primary pointer of a
		 * touch sequence is the first finger on the glass. Anything still carried at that
		 * moment never reported its end, so it is dropped here rather than counted as
		 * half of a pinch that is not happening.
		 */
		if (event.isPrimary && d.carried.size > 0) releaseCarried();
		if (d.carried.size === 0) {
			/*
			 * On the window, not on the canvas. Capture is a nicety that can be refused,
			 * and without it a finger that slides off the canvas — onto the conversation,
			 * the rail, the composer — lifts somewhere this element never hears about,
			 * and the pool keeps it. The handlers ask `carried` which fingers are theirs,
			 * so listening wider costs nothing and closes that gap.
			 */
			window.addEventListener("pointermove", onTouchMove);
			window.addEventListener("pointerup", onTouchEnd);
			window.addEventListener("pointercancel", onTouchEnd);
		}
		d.carried.add(event.pointerId);
		/*
		 * A finger landing on a moving canvas catches it, as a hand catches a spinning list: an agent's
		 * glide stops where it is, and the browser's own coast after a flick is not given the finger to
		 * carry on with (`holdTouch` cancels its touch start, as for a kept finger), or on an iPad the
		 * fingers that followed stayed the scroll's and no pinch could begin until it had run down. The
		 * pool pans for the finger instead (`touch`, `caught`), and a second finger is a pinch as ever.
		 */
		if (d.touches.count() === 0) {
			d.caught = d.outer.ctl.gliding() || performance.now() - d.outer.lastScroll < d.outer.COAST_MS;
			if (d.caught) {
				d.outer.ctl.cancelGlide();
				d.keptTouches.add(event.pointerId);
			}
		}
		d.touch("down", d.fingerOf(event));
		try {
			d.outer.el().setPointerCapture(event.pointerId);
		} catch {
			// Capture is per-pointer and can be refused; the listeners above still carry
			// the gesture for as long as the finger stays over the canvas.
		}
	};

	return {
		releaseCarried,
		onTouchMove,
		onTouchEnd,
		beginTouch,
	};
}
