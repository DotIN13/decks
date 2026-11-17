import type { Touches } from "../camera/touch.ts";
import type { Camera } from "@decks/protocol";
import { onCleanup } from "solid-js";
import { zoomAbout, type Viewport } from "../camera/camera.ts";
import type { CameraController } from "../camera/controller.ts";

/** What `listenSafariPinch` reads of `createViewInput` (`input.ts`), each read when it is used. */
export interface ListenSafariPinchNeeds {
	readonly touches: Touches;
	readonly wheeling: { gesturing: boolean; onWheel: (event: WheelEvent) => void; };
	readonly element: HTMLDivElement;
	readonly pushCamera: (cam: Camera) => void;
	readonly ctl: CameraController;
	readonly view: () => Viewport;
	readonly stoppedMoving: () => void;
}

export function listenSafariPinch(d: ListenSafariPinchNeeds) {
	/**
	 * The canvas's pinch has two fingers: a gesture event is about them and changes nothing. With fewer
	 * (the first finger already taken by the browser's scroll, which cancels its pointer, or a trackpad)
	 * the gesture events are the pinch.
	 */
	const fingersDown = () => d.touches.count() >= 2;

	let gestureScale = 1;

	let viewAt = { left: 0, top: 0 };

	const onGestureStart = (event: Event) => {
		event.preventDefault();
		gestureScale = 1;
		d.wheeling.gesturing = true;
		if (fingersDown()) return;
		const r = d.element.getBoundingClientRect();
		viewAt = { left: r.left, top: r.top };
	};

	const onGestureChange = (event: Event) => {
		event.preventDefault();
		const g = event as Event & { scale: number; clientX: number; clientY: number };
		const factor = g.scale / gestureScale;
		// Followed even while the canvas's pinch has the fingers, so handing back to these events does not jump.
		gestureScale = g.scale;
		if (fingersDown() || !Number.isFinite(factor) || factor <= 0 || factor === 1) return;
		d.pushCamera(zoomAbout(d.ctl.now(), d.view(), { x: g.clientX - viewAt.left, y: g.clientY - viewAt.top }, factor));
	};

	const onGestureEnd = (event: Event) => {
		event.preventDefault();
		d.wheeling.gesturing = false;
		if (fingersDown()) return;
		d.stoppedMoving();
	};

	d.element.addEventListener("gesturestart", onGestureStart, { passive: false });

	d.element.addEventListener("gesturechange", onGestureChange, { passive: false });

	d.element.addEventListener("gestureend", onGestureEnd, { passive: false });

	onCleanup(() => {
		d.element.removeEventListener("gesturestart", onGestureStart);
		d.element.removeEventListener("gesturechange", onGestureChange);
		d.element.removeEventListener("gestureend", onGestureEnd);
	});

}
