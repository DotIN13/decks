import { type Viewport } from "../camera/camera.ts";
import type { CameraController } from "../camera/controller.ts";
import { viewPoint } from "../camera/coords.ts";
import type { CanvasViewProps } from "./CanvasView.tsx";
import type { ViewInputDeps } from "./input.ts";

/** What `createWheel` reads of `createViewInput` (`input.ts`), each read when it is used. */
export interface WheelNeeds {
	readonly ctl: CameraController;
	readonly props: CanvasViewProps;
	readonly deps: ViewInputDeps;
	readonly worldAt: (event: { clientX: number; clientY: number; }) => { x: number; y: number; };
	readonly view: () => Viewport;
	readonly el: () => HTMLDivElement;
}

export function createWheel(d: WheelNeeds) {
	/**
	 * Where the pointer is, in canvas coordinates — which are the event's own client ones.
	 *
	 * There was a cached `getBoundingClientRect` here, refreshed every 250 ms, and a
	 * subtraction at each of three call sites. The canvas element *is* the viewport, so all of
	 * that was adding zero: `camera/coords.ts` sets out why, and `checkCanvasOrigin` — called
	 * at mount — is what stops it quietly ceasing to be true.
	 */
	const local = viewPoint;

	/** A wheel or a trackpad's pinch, already in canvas coordinates (`camera/controller.ts`). */
	const wheel = d.ctl.wheel;

	/** Safari's pinch is under way (`gesturechange`): a wheel it may send beside it is not a second zoom. */
	let gesturing = false;

	const nativeWheel = typeof localStorage !== "undefined" && localStorage.getItem("decks.nativeWheel") === "1";

	/**
	 * What the wheel's steps have asked for and the scroll has not taken yet, below a pixel. The
	 * browser keeps whole pixels of a `scrollBy`, so a slow diagonal's smaller direction (a trackpad
	 * step of 1.3 right and 0.9 down) was dropped step after step and the pan went as a staircase;
	 * kept here, it moves once it adds up to a pixel, and the pan goes the fingers' way.
	 */
	const wheelCarry = { x: 0, y: 0 };

	const onWheel = (event: WheelEvent) => {
		const zooming = event.ctrlKey || event.metaKey;
		if (zooming && gesturing) {
			event.preventDefault();
			return;
		}
		/*
		 * A sideways scroll over a card's wide table scrolls the table, as it would in a page; Shift and
		 * a wheel is sideways too.
		 */
		if (!zooming && d.props.pen && !d.props.drawing) {
			const sideways = event.shiftKey && event.deltaX === 0 ? event.deltaY : Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : 0;
			if (sideways !== 0 && d.deps.scrollBy(d.worldAt(event), sideways / d.ctl.now().zoom)) {
				event.preventDefault();
				return;
			}
		}
		/*
		 * A two-finger scroll moves the canvas by the wheel's own deltas, and the camera follows from the
		 * scroll event (`onScroll`). Left to the browser, a trackpad's scroll and its momentum are held to
		 * an axis whenever they run near one (Chrome's rails on a Mac, within about 27 degrees; Safari
		 * drops the smaller delta), so a flick went only a few ways. The deltas a page is given are the
		 * trackpad's own. `decks.nativeWheel` = "1" in localStorage leaves it to the browser, for measuring.
		 */
		if (!zooming) {
			if (nativeWheel) return;
			event.preventDefault();
			const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? d.view().height : 1;
			// Shift turns a mouse wheel sideways, as the browser would have.
			const dx = (event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX) * unit;
			const dy = (event.shiftKey && event.deltaX === 0 ? 0 : event.deltaY) * unit;
			wheelCarry.x += dx;
			wheelCarry.y += dy;
			const left = Math.trunc(wheelCarry.x);
			const top = Math.trunc(wheelCarry.y);
			wheelCarry.x -= left;
			wheelCarry.y -= top;
			if (left !== 0 || top !== 0) d.el().scrollBy({ left, top, behavior: "instant" });
			return;
		}
		event.preventDefault();
		const at = local(event);
		// `ctrlKey` is a trackpad pinch, not a key anybody pressed; `metaKey` is the
		// deliberate mouse-wheel zoom. Everything else is a two-finger scroll.
		wheel({ x: at.x, y: at.y, deltaX: event.deltaX, deltaY: event.deltaY, zooming: event.ctrlKey || event.metaKey, pinch: event.ctrlKey && !event.metaKey });
	};

	return {
		get gesturing() {
			return gesturing;
		},
		set gesturing(next) {
			gesturing = next;
		},
		onWheel,
	};
}
