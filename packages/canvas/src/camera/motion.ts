import type { Camera } from "@decks/protocol";
import { createSignal, onCleanup } from "solid-js";
import { type CameraHost } from "./controller.ts";

/** What `createMotion` reads of `createCameraController` (`controller.ts`), each read when it is used. */
export interface MotionNeeds {
	readonly host: CameraHost;
}

export function createMotion(d: MotionNeeds) {
	/**
	 * A pan *gesture* is in flight — a finger down, a drag on bare canvas, space and a drag.
	 *
	 * The cursor's own state, and only that (`index.css`: `cursor: grabbing`). It is set on the
	 * press and cleared on the release, so it is true *before* the camera has moved and false the
	 * instant the hand stops. Nothing else reads it: the camera's own state is not something this
	 * signal can answer, because a wheel scroll pans the camera and presses nothing.
	 */
	const [panning, setPanning] = createSignal(false);

	/**
	 * Whether the camera's *scale* is changing right now, as opposed to its position.
	 *
	 * The two are not the same kind of work, and the difference is the whole reason this
	 * signal exists. Moving the world is a transform the compositor already holds pictures
	 * for, so a pan costs almost nothing however many cards are on the canvas. Scaling it
	 * asks every card's document to be drawn again at a size it has never been drawn at —
	 * and a card is an iframe, which is a whole document to redraw. Measured on twelve
	 * cards at 4× CPU throttle: 69ms of work per finger movement while panning, 134ms
	 * while pinching, and the gap grows with the number of cards in view.
	 *
	 * So while the scale is moving, the cards are put on layers of their own
	 * (`index.css`), which lets the compositor stretch the picture it already has instead
	 * of the main thread drawing a new one: 134ms → 56ms, with nothing to see at rest
	 * (measured: 0.2% of pixels differ, at the edges of letters). It is switched off again
	 * a moment after the gesture stops, because a layer is a texture held in memory and a
	 * canvas of them is not free.
	 */
	const [scaling, setScaling] = createSignal(false);

	let scaleSettle: ReturnType<typeof setTimeout> | undefined;

	/**
	 * Whether the camera is moving at all — a pan as well as a zoom.
	 *
	 * `scaling` answers "is the picture the wrong size"; this answers "is the picture in
	 * motion", and the canvas renderers need the second one too. A pan repaints the page, so
	 * Chrome reports every drawable element as changed on every step, and a renderer that
	 * reads a `paint` event as "this document changed" redraws every card on every step of
	 * a pan for nothing. Same tail as the scale settle, for the same reason.
	 */
	const [moving, setMoving] = createSignal(false);

	let moveSettle: ReturnType<typeof setTimeout> | undefined;

	/**
	 * Whether the camera is gliding right now — for the checks, not for the drawing.
	 *
	 * `data-panning` and `data-scaling` are the other two halves of "the camera is moving and this
	 * is what kind of work that is"; this is the third case, a move the app made on the reader's
	 * behalf, and a check has no other way to wait for it to arrive without sleeping.
	 */
	const [gliding, setGliding] = createSignal(false);

	/** The camera and window the world was last placed for (`writeTransform`). */
	let written: { cam: Camera; width: number; height: number } | undefined;

	const writeTransform = (cam: Camera) => {
		const v = d.host.view();
		written = { cam, width: v.width, height: v.height };
		d.host.place(cam);
	};

	/**
	 * Say the scale is moving, and arrange to notice when it stops.
	 *
	 * The tail matters: a pinch delivers its steps as separate events with nothing to mark
	 * the end of the *scaling* in particular, and dropping the layers between two frames of
	 * one gesture would pay for them twice. 300ms is longer than any gap inside a gesture
	 * and shorter than anyone would notice holding.
	 */
	const nowMoving = () => {
		if (!moving()) setMoving(true);
		clearTimeout(moveSettle);
		moveSettle = setTimeout(() => setMoving(false), 160);
	};

	onCleanup(() => clearTimeout(moveSettle));

	const nowScaling = () => {
		if (!scaling()) setScaling(true);
		clearTimeout(scaleSettle);
		scaleSettle = setTimeout(() => setScaling(false), 300);
	};

	onCleanup(() => clearTimeout(scaleSettle));

	/**
	 * The camera has stopped and nothing more is coming: the moving and scaling states end now, not
	 * after their tails. When the last finger lifts from a pinch there is no next step to wait for,
	 * and the tails (160 and 300 ms) were that much more of tiles painted at the moving scale before
	 * the sharp ones were asked for (on an iPad mini, sharp about 620 ms after the lift). A wheel or
	 * a trackpad's pinch has no lift, so it keeps the tails. `knobs.pinchTail` (`debug.ts`) keeps them after
	 * a pinch too, for measuring.
	 */
	const stopped = () => {
		clearTimeout(moveSettle);
		clearTimeout(scaleSettle);
		if (moving()) setMoving(false);
		if (scaling()) setScaling(false);
	};

	return {
		nowScaling,
		nowMoving,
		writeTransform,
		setGliding,
		get written() {
			return written;
		},
		set written(next) {
			written = next;
		},
		moving,
		gliding,
		panning,
		scaling,
		setPanning,
		stopped,
	};
}
