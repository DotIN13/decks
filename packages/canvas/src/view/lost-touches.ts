import type { Touches } from "../camera/touch.ts";
import { onCleanup } from "solid-js";
import { type FingersNeeds } from "./fingers.ts";

/** What `watchLostTouches` reads of `createFingers` (`fingers.ts`), each read when it is used. */
export interface WatchLostTouchesNeeds {
	readonly carried: Set<number>;
	readonly touches: Touches;
	readonly releaseCarried: () => void;
	readonly claimed: Set<number>;
	readonly outer: FingersNeeds;
	readonly onTouchMove: (event: PointerEvent) => void;
	readonly onTouchEnd: (event: PointerEvent) => void;
}

export function watchLostTouches(d: WatchLostTouchesNeeds) {
	/**
	 * The whole hand, gone: the tab went to the background, or the OS took the gesture.
	 *
	 * Neither of those ends a touch in a way any document is told about — the events
	 * simply stop — so every finger in the pool is released. Without this, backgrounding the
	 * tab mid-pan is enough to leave the canvas reading every later touch as a pinch.
	 */
	const lostTouches = () => {
		if (d.carried.size === 0 && d.touches.count() === 0) return;
		d.releaseCarried();
		for (const id of d.touches.ids()) d.touches.up(id);
		d.claimed.clear();
		d.outer.setPanning(false);
	};

	const onHidden = () => {
		if (document.visibilityState === "hidden") lostTouches();
	};

	/*
	 * Focus moving into a card's field, or another frame, blurs this window too, and that happens on
	 * an ordinary tap — so a bare `blur` handler would throw the gesture away as it began.
	 * `document.hasFocus()` is the difference: it counts a nested frame as this document having focus,
	 * and is false only when the browser or the tab really has lost it.
	 */
	const onBlur = () => {
		if (document.hasFocus()) return;
		lostTouches();
	};

	window.addEventListener("blur", onBlur);

	document.addEventListener("visibilitychange", onHidden);

	onCleanup(() => {
		window.removeEventListener("blur", onBlur);
		document.removeEventListener("visibilitychange", onHidden);
		window.removeEventListener("pointermove", d.onTouchMove);
		window.removeEventListener("pointerup", d.onTouchEnd);
		window.removeEventListener("pointercancel", d.onTouchEnd);
	});

}
