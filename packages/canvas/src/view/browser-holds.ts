import type { KeptTouches } from "./fingers.ts";
import { onCleanup } from "solid-js";
import { type ViewInputDeps } from "./input.ts";

/** What `holdBrowserScroll` reads of `createViewInput` (`input.ts`), each read when it is used. */
export interface HoldBrowserScrollNeeds {
	readonly element: HTMLDivElement;
	lastScroll: number;
	readonly deps: ViewInputDeps;
	readonly keptTouches: KeptTouches;
}

export function holdBrowserScroll(d: HoldBrowserScrollNeeds) {
	/*
	 * A pinch over anything that is not the canvas (the toolbars, the composer, the conversation,
	 * the panels, a dialog) does nothing. Chrome sends a trackpad pinch as a wheel event with
	 * `ctrlKey`, and one nobody cancels zooms the whole page. The canvas zooms only for a pinch
	 * over the stage itself (`onWheel`).
	 */
	const pinchOver = (event: WheelEvent) => {
		if (event.ctrlKey && !d.element.contains(event.target as Node | null)) event.preventDefault();
	};

	window.addEventListener("wheel", pinchOver, { capture: true, passive: false });

	onCleanup(() => window.removeEventListener("wheel", pinchOver, { capture: true }));

	// The stage scrolled: the camera follows (`CanvasView.tsx`, `scrolled`).
	const onScroll = () => {
		d.lastScroll = performance.now();
		d.deps.scrolled();
	};

	d.element.addEventListener("scroll", onScroll, { passive: true });

	onCleanup(() => d.element.removeEventListener("scroll", onScroll));

	/*
	 * The keys a scroll area scrolls by (Space, the arrows, Page Up and Down, Home and End) are the
	 * canvas's own when the focus is on it (a nudge, a pan, a tool): the stage does not scroll for
	 * them. Typing in a card or a field keeps them.
	 */
	const scrollKeys = new Set([" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End"]);

	const holdScrollKeys = (event: KeyboardEvent) => {
		if (!scrollKeys.has(event.key)) return;
		const target = event.target as HTMLElement | null;
		if (target?.closest?.("input, textarea, select, [contenteditable]:not([contenteditable='false'])")) return;
		event.preventDefault();
	};

	d.element.addEventListener("keydown", holdScrollKeys);

	onCleanup(() => d.element.removeEventListener("keydown", holdScrollKeys));

	/*
	 * A finger on an item, a handle or a board is the editor's: its touch must not scroll the stage.
	 * The pointer event comes first and says so (`keepTouch`); cancelling the touch's start is what
	 * keeps the browser from taking it. Every other finger is left to scroll natively.
	 */
	const holdTouch = (event: TouchEvent) => {
		if (d.keptTouches.size > 0) event.preventDefault();
	};

	d.element.addEventListener("touchstart", holdTouch, { passive: false });

	onCleanup(() => d.element.removeEventListener("touchstart", holdTouch));

	/*
	 * A finger kept after it landed (a hold, `pointer.ts`): its touch began as the browser's, so its moves
	 * are held back too, by a listener there only while a finger is kept, so a plain pan never waits for
	 * the page. The browser has not begun to scroll a finger that stayed within its slop.
	 */
	const holdMove = (event: TouchEvent) => {
		if (d.keptTouches.size > 0 && event.cancelable) event.preventDefault();
	};

	let holdingMoves = false;

	d.keptTouches.changed = () => {
		const want = d.keptTouches.size > 0;
		if (want === holdingMoves) return;
		holdingMoves = want;
		if (want) d.element.addEventListener("touchmove", holdMove, { passive: false });
		else d.element.removeEventListener("touchmove", holdMove);
	};

	onCleanup(() => {
		d.keptTouches.changed = undefined;
		d.element.removeEventListener("touchmove", holdMove);
	});

	// A kept finger lets go when it lifts, wherever it was kept: one left behind would hold every later touch from scrolling.
	const letGo = (event: PointerEvent) => d.keptTouches.delete(event.pointerId);

	for (const kind of ["pointerup", "pointercancel"] as const) window.addEventListener(kind, letGo, true);

	onCleanup(() => {
		for (const kind of ["pointerup", "pointercancel"] as const) window.removeEventListener(kind, letGo, true);
	});

	/*
	 * Two fingers on the canvas are one pinch, and the canvas's own (`touch`, `pinchCamera`): it zooms
	 * about the fingers and pans with them. So while two are down the browser does not scroll with
	 * them too, and Safari's gesture events, which describe the same fingers, only stop the page
	 * zooming. Both used to zoom the camera, each by the whole spread: on an iPad a pinch of 2.5
	 * times zoomed 6.4. A trackpad pinch in Safari, with no finger down, is still the gesture events'.
	 * The listener that holds the scroll is only there while two fingers are, so one finger's scroll
	 * never waits for the page.
	 */
	const holdScroll = (event: TouchEvent) => {
		if (event.touches.length >= 2) event.preventDefault();
	};

	let holding = false;

	const twoFingers = (event: TouchEvent) => {
		const two = event.touches.length >= 2;
		if (two === holding) return;
		holding = two;
		if (two) d.element.addEventListener("touchmove", holdScroll, { passive: false });
		else d.element.removeEventListener("touchmove", holdScroll);
	};

	for (const kind of ["touchstart", "touchend", "touchcancel"] as const) d.element.addEventListener(kind, twoFingers, { passive: true });

	onCleanup(() => {
		for (const kind of ["touchstart", "touchend", "touchcancel"] as const) d.element.removeEventListener(kind, twoFingers);
		d.element.removeEventListener("touchmove", holdScroll);
	});

}
