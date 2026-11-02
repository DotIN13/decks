/**
 * The fingers on the stage, pooled, and the camera they move: one tracker for the whole stage, fed
 * by this document's pointer events and by the boards' pages (`frame-host.ts`), with the claims, the
 * coast at release and the hand lost to the OS. `createFingers` is called once by the Stage.
 */
import type { Camera } from "@decks/protocol";
import { velocityFrom, type Sample } from "@decks/ui";
import { pan, pinchCamera, type Viewport } from "../camera/camera.ts";
import { stagePoint } from "../camera/coords.ts";
import { knobs } from "../debug.ts";
import { coastStart, createTouches, type Finger, type TouchStep } from "../input/touch.ts";
import { onCleanup } from "solid-js";

/** What the fingers need of the stage: where they are, the camera they move, and what a lift does. */
interface FingersHost {
	/** The stage element, for pointer capture. */
	element: () => HTMLElement;
	camera: () => Camera;
	view: () => Viewport;
	/** The camera, moved by a pan or a pinch step. */
	push: (camera: Camera) => void;
	/** A release with speed coasts on; a finger down stops a coast. */
	coast: (thrown: NonNullable<ReturnType<typeof coastStart>>) => void;
	cancelCoast: () => void;
	/** A pinch's lift ends the moving state at once. */
	stopped: () => void;
	setPanning: (on: boolean) => void;
	/** Bare canvas or something drawn on it: a tap there clears the selection. */
	onCanvas: (target: EventTarget | null) => boolean;
	deselect: () => void;
}

/*
 * Every finger on the canvas, wherever it landed, and the camera they move.
 *
 * **One set of fingers for the whole stage**, and that is the load-bearing decision
 * here. A pinch does not respect the boundaries of the documents it happens over: one
 * finger can be inside a board's iframe and the other on bare canvas, or one on a
 * board's title bar and the other on a third board. Each of those is two event
 * streams and one gesture, and a tracker per stream turns it into two one-finger pans
 * — which is precisely the bug that made a pinch shove the canvas about. So the
 * fingers are pooled here (`touch.ts` reduces the pool), and the other documents feed
 * them in: `frame-gestures.ts` for a board's own document, `BoardFrame` for its title
 * bar.
 *
 * A finger can also be **claimed** by whoever it landed on — a scrollable embed, a
 * board being dragged by its bar. A claimed finger still counts towards the pool, so
 * a second finger makes a pinch with the right positions; it just does not pan. Two
 * fingers always win: a pinch clears every claim, because zooming out of a board you
 * had started to drag is a change of mind, not an ambiguity.
 */
export function createFingers(host: FingersHost) {
	const touches = createTouches();
	/** Fingers whose press the editor took (`keepTouch`): their touch is kept from scrolling the stage. */
	const keptTouches = new Set<number>();
	/** Fingers down on a board's page, as its messages tell them (`frame-gestures.ts`), by the stage's id. */
	const forwarded = new Set<number>();
	/** Hold the browser's scroll while two fingers are down, here or on a board (the stage sets it when it mounts, `setSyncHold`). */
	let syncHold = (): void => {};
	const claimed = new Set<number>();
	/** Fingers this document is carrying, as opposed to ones reported from a frame. */
	const carried = new Set<number>();
	/*
	 * The pan so far, as a path the camera has been dragged along, for the speed at release.
	 * A gesture that was ever more than a one-finger pan of the camera (a pinch, a finger a
	 * board claimed) does not coast.
	 */
	let trail: Sample[] = [];
	let trailAt = { x: 0, y: 0 };
	let noCoast = false;
	/** The gesture so far has been a pinch: its lift ends the moving state at once (`stoppedMoving`). */
	let pinched = false;
	/**
	 * A finger of this document's, in the stage's own coordinates.
	 *
	 * The pool is kept in stage coordinates because that is the space the camera works
	 * in, and because a board's document has no other way to describe where a finger is —
	 * it converts on its way out (`frame-gestures.ts`). Converting again on the way in
	 * would subtract the stage's offset twice, which is a pinch that walks the canvas 90px
	 * *down* for a gesture that never moved vertically at all: exactly the bug that this
	 * conversion existing in one place instead of two is meant to stop.
	 */
	const fingerOf = (event: PointerEvent): Finger => {
		const at = stagePoint(event);
		return { id: event.pointerId, x: at.x, y: at.y };
	};

	/** One finger's worth of a gesture, from this document or from a board's. */
	/**
	 * Fingers on the stage itself pan it natively (`camera/scroll-area.ts`): the browser scrolls, and
	 * the camera follows from the scroll. So a finger of this document moves nothing here, and nothing
	 * coasts after it; a finger reported from a board's page (`decks:touch`) still pans by hand.
	 */
	const touch = (phase: "down" | "move" | "up", finger: Finger, native = false): TouchStep => {
		if (phase === "down") {
			// A finger on the glass stops a coast, the way a hand stops a spinning list.
			host.cancelCoast();
			touches.down(finger);
			if (touches.count() === 1) {
				trail = [];
				trailAt = { x: 0, y: 0 };
				noCoast = false;
				pinched = false;
			}
			host.setPanning(true);
			return { kind: "idle" };
		}
		if (phase === "up") {
			touches.up(finger.id);
			claimed.delete(finger.id);
			if (touches.count() === 0) {
				host.setPanning(false);
				const thrown = noCoast ? undefined : coastStart(velocityFrom(trail, performance.now()));
				trail = [];
				if (thrown) host.coast(thrown);
				else if (pinched && knobs.pinchTail !== true) host.stopped();
			}
			return { kind: "idle" };
		}

		const step = touches.move(finger);
		if (step.kind === "pinch") {
			noCoast = true;
			pinched = true;
			claimed.clear();
			host.push(pinchCamera(host.camera(), host.view(), step.from, step.to));
			return step;
		}
		if (step.kind === "pan") {
			if (claimed.has(finger.id) || native) noCoast = true;
			else {
				host.push(pan(host.camera(), step.dx, step.dy));
				trailAt = { x: trailAt.x + step.dx, y: trailAt.y + step.dy };
				trail.push({ ...trailAt, t: performance.now() });
				if (trail.length > 8) trail.shift();
			}
		}
		return step;
	};

	const onTouchMove = (event: PointerEvent) => {
		if (!carried.has(event.pointerId)) return;
		touch("move", fingerOf(event), true);
	};

	const onTouchEnd = (event: PointerEvent) => {
		if (!carried.has(event.pointerId)) return;
		carried.delete(event.pointerId);
		keptTouches.delete(event.pointerId);
		// The browser took the finger to scroll with: its momentum is the browser's too.
		if (event.type === "pointercancel") noCoast = true;
		touch("up", fingerOf(event), true);
		if (carried.size > 0) return;
		window.removeEventListener("pointermove", onTouchMove);
		window.removeEventListener("pointerup", onTouchEnd);
		window.removeEventListener("pointercancel", onTouchEnd);
	};

	/** Hand back every finger this document is carrying, wherever each one got to. */
	const releaseCarried = () => {
		for (const id of [...carried]) {
			carried.delete(id);
			touch("up", { id, x: 0, y: 0 });
		}
	};

	const beginTouch = (event: PointerEvent) => {
		// A tap on bare canvas clears the selection, exactly as a click does. Decided on
		// the way down rather than on the way up: a pan that starts on empty stage is not
		// a gesture that wants to keep a component selected either.
		if (host.onCanvas(event.target)) host.deselect();
		/*
		 * The browser's own word for "nothing else is down": the primary pointer of a
		 * touch sequence is the first finger on the glass. Anything still carried at that
		 * moment never reported its end, so it is dropped here rather than counted as
		 * half of a pinch that is not happening.
		 */
		if (event.isPrimary && carried.size > 0) releaseCarried();
		if (carried.size === 0) {
			/*
			 * On the window, not on the stage. Capture is a nicety that can be refused,
			 * and without it a finger that slides off the canvas — onto the conversation,
			 * the rail, the composer — lifts somewhere this element never hears about,
			 * and the pool keeps it. The handlers ask `carried` which fingers are theirs,
			 * so listening wider costs nothing and closes that gap.
			 */
			window.addEventListener("pointermove", onTouchMove);
			window.addEventListener("pointerup", onTouchEnd);
			window.addEventListener("pointercancel", onTouchEnd);
		}
		carried.add(event.pointerId);
		touch("down", fingerOf(event));
		try {
			host.element().setPointerCapture(event.pointerId);
		} catch {
			// Capture is per-pointer and can be refused; the listeners above still carry
			// the gesture for as long as the finger stays over the stage.
		}
	};

	/**
	 * The whole hand, gone: the tab went to the background, or the OS took the gesture.
	 *
	 * Neither of those ends a touch in a way any document is told about — the events
	 * simply stop — so every finger in the pool is released, including the ones reported
	 * from a board's own document, because whatever took the gesture took all of them.
	 * Without this, backgrounding the tab mid-pan is enough to leave the canvas reading
	 * every later touch as a pinch.
	 */
	const lostTouches = () => {
		if (carried.size === 0 && touches.count() === 0) return;
		releaseCarried();
		for (const id of touches.ids()) touches.up(id);
		claimed.clear();
		host.setPanning(false);
	};
	const onHidden = () => {
		if (document.visibilityState === "hidden") lostTouches();
	};
	/*
	 * Focus moving *into* a board blurs this window too, and that happens on an ordinary
	 * tap — so a bare `blur` handler would throw the gesture away as it began.
	 * `document.hasFocus()` is the difference: it counts a nested frame as this document
	 * having focus, and is false only when the browser or the tab really has lost it.
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
		window.removeEventListener("pointermove", onTouchMove);
		window.removeEventListener("pointerup", onTouchEnd);
		window.removeEventListener("pointercancel", onTouchEnd);
	});

	return {
		touches,
		keptTouches,
		forwarded,
		claimed,
		touch,
		beginTouch,
		/** Ask the hold whether two fingers are down now, here or on a board. */
		syncHold: () => syncHold(),
		setSyncHold: (next: () => void) => {
			syncHold = next;
		},
	};
}
