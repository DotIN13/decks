import { onCleanup } from "solid-js";
import { type CanvasInkProps } from "./CanvasInk.tsx";

/** What `createInkFingers` reads of `CanvasInk` (`CanvasInk.tsx`), each read when it is used. */
export interface InkFingersNeeds {
	readonly palms: Set<number>;
	readonly props: CanvasInkProps;
}

export function createInkFingers(d: InkFingersNeeds) {
	/*
	 * Two fingers tapped together take back the last edit, three put it back, as in a notes app. A tap
	 * is every finger down and up within a moment, none of them having travelled; watched on the
	 * window, because a finger this sheet lets through is captured by the canvas beneath it.
	 */
	const fingers = new Map<number, { x: number; y: number }>();

	let tapStarted = 0;

	let tapMost = 0;

	let tapSpoiled = false;

	const fingerDown = (event: PointerEvent) => {
		if (fingers.size === 0) {
			tapStarted = performance.now();
			tapMost = 0;
			tapSpoiled = false;
		}
		fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
		tapMost = Math.max(tapMost, fingers.size);
	};

	const fingerMove = (event: PointerEvent) => {
		const at = fingers.get(event.pointerId);
		if (at && Math.hypot(event.clientX - at.x, event.clientY - at.y) > 12) tapSpoiled = true;
	};

	const fingerUp = (event: PointerEvent) => {
		// A palm lifted wherever it was: forgotten, whether or not the glass heard it.
		if (d.palms.has(event.pointerId)) queueMicrotask(() => d.palms.delete(event.pointerId));
		if (!fingers.delete(event.pointerId) || fingers.size > 0) return;
		if (event.type === "pointercancel" || tapSpoiled || tapMost < 2 || performance.now() - tapStarted > 400) return;
		d.props.onStep?.(tapMost === 2 ? "undo" : "redo");
	};

	addEventListener("pointermove", fingerMove, true);

	addEventListener("pointerup", fingerUp, true);

	addEventListener("pointercancel", fingerUp, true);

	onCleanup(() => {
		removeEventListener("pointermove", fingerMove, true);
		removeEventListener("pointerup", fingerUp, true);
		removeEventListener("pointercancel", fingerUp, true);
	});

	return {
		fingerDown,
	};
}
