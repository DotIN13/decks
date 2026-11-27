import type { Setter } from "solid-js";
import { knobs } from "../base/debug.ts";
import type { Camera } from "@decks/protocol";
import { pan, pinchCamera, type Viewport } from "../camera/camera.ts";
import type { CameraController } from "../camera/controller.ts";
import { viewPoint } from "../camera/coords.ts";
import { createTouches, type Finger, type TouchStep } from "../camera/touch.ts";
import type { CanvasViewProps } from "./CanvasView.tsx";
import type { ViewInputDeps } from "./input.ts";
import { watchLostTouches } from "./lost-touches.ts";
import { createFingerPress } from "./finger-press.ts";

/** The fingers whose touch is kept from the browser's scroll, saying when that changes (`holdMove`). */
export class KeptTouches extends Set<number> {
	changed: (() => void) | undefined;
	override add(id: number): this {
		super.add(id);
		this.changed?.();
		return this;
	}
	override delete(id: number): boolean {
		const was = super.delete(id);
		this.changed?.();
		return was;
	}
	override clear(): void {
		super.clear();
		this.changed?.();
	}
}

/** What `createFingers` reads of `createViewInput` (`input.ts`), each read when it is used. */
export interface FingersNeeds {
	readonly cancelCoast: () => void;
	readonly setPanning: Setter<boolean>;
	readonly ctl: CameraController;
	readonly stoppedMoving: () => void;
	readonly pushCamera: (cam: Camera) => void;
	readonly view: () => Viewport;
	readonly deps: ViewInputDeps;
	readonly onCanvas: (target: EventTarget | null) => boolean;
	readonly props: CanvasViewProps;
	readonly lastScroll: number;
	readonly COAST_MS: number;
	readonly el: () => HTMLDivElement;
}

export function createFingers(d: FingersNeeds) {
	/**
	 * Every finger on the canvas, and the camera they move.
	 *
	 * Fingers on the canvas pan it natively (`camera/scroll-area.ts`): the browser scrolls, and the
	 * camera follows from the scroll. Two are one pinch, the canvas's own (`touch.ts` reduces the pool,
	 * `pinchCamera` moves the camera), wherever each landed: on bare canvas, on a card or on an item's
	 * bar. A finger can be **claimed** by whoever it landed on (an item carried by its bar or its edge):
	 * it still counts towards the pool, so a second finger makes a pinch with the right positions, and a
	 * pinch clears every claim, because zooming out of an item you had started to drag is a change of
	 * mind, not an ambiguity.
	 */
	const touches = createTouches();

	/** Fingers whose press the editor took (`keepTouch`): their touch is kept from scrolling the canvas. */
	const keptTouches = new KeptTouches();

	const claimed = new Set<number>();

	/** Fingers this document is carrying. */
	const carried = new Set<number>();

	/** The gesture so far has been a pinch: its lift ends the moving state at once (`stoppedMoving`). */
	let pinched = false;

	/**
	 * The first finger landed on a moving canvas and caught it (`beginTouch`): the browser was kept
	 * from taking it for a scroll, so until it lifts this pool pans for it, and a second finger makes
	 * the pinch as ever.
	 */
	let caught = false;

	/**
	 * A finger landed on a card's cover (`gestures.panTouch`), which the browser cannot scroll from: until the
	 * last finger lifts this pool pans for it, as for a caught finger, and a throw coasts on the lift (`ctl.coast`).
	 */
	let poolPans = false;

	/** The pool's last pan steps, for the coast after a throw: canvas pixels and when. */
	const panned: Array<{ t: number; dx: number; dy: number }> = [];

	/** A finger, in the canvas's own coordinates: the space the camera works in. */
	const fingerOf = (event: PointerEvent): Finger => {
		const at = viewPoint(event);
		return { id: event.pointerId, x: at.x, y: at.y };
	};

	/** One finger's worth of a gesture. A one-finger pan is the browser's scroll, so only a pinch moves the camera here. */
	const touch = (phase: "down" | "move" | "up", finger: Finger): TouchStep => {
		// For the checks: every step of the pool, when asked for (`knobs.touchLog`).
		const log = knobs.touchLog;
		if (log) log.push({ phase, id: finger.id, x: Math.round(finger.x), y: Math.round(finger.y), count: touches.count(), claimed: claimed.size, kept: keptTouches.size, t: Math.round(performance.now()) });
		if (phase === "down") {
			// A finger on the glass stops a coast, the way a hand stops a spinning list.
			d.cancelCoast();
			touches.down(finger);
			if (touches.count() === 1) {
				pinched = false;
				panned.length = 0;
			}
			d.setPanning(true);
			return { kind: "idle" };
		}
		if (phase === "up") {
			touches.up(finger.id);
			claimed.delete(finger.id);
			if (touches.count() === 0) {
				// A throw the pool panned for coasts on, as the browser's own scroll would (the last 100 ms of it).
				const now = performance.now();
				const recent = panned.filter((one) => now - one.t < 100);
				if ((caught || poolPans) && !pinched && recent.length > 1 && now - recent.at(-1)!.t < 60) {
					const span = Math.max(16, recent.at(-1)!.t - recent[0]!.t);
					const vx = recent.slice(1).reduce((sum, one) => sum + one.dx, 0) / span;
					const vy = recent.slice(1).reduce((sum, one) => sum + one.dy, 0) / span;
					if (Math.hypot(vx, vy) > 0.05) d.ctl.coast({ vx, vy });
				}
				panned.length = 0;
				caught = false;
				poolPans = false;
				d.setPanning(false);
				if (pinched && !knobs.pinchTail) d.stoppedMoving();
			}
			return { kind: "idle" };
		}

		const step = touches.move(finger);
		if (log) log.push({ phase: "step", id: finger.id, kind: step.kind, t: Math.round(performance.now()) });
		if (step.kind === "pinch") {
			pinched = true;
			claimed.clear();
			d.pushCamera(pinchCamera(d.ctl.now(), d.view(), step.from, step.to));
		} else if (step.kind === "pan" && (caught || poolPans) && !claimed.has(finger.id)) {
			panned.push({ t: performance.now(), dx: step.dx, dy: step.dy });
			if (panned.length > 12) panned.shift();
			d.pushCamera(pan(d.ctl.now(), step.dx, step.dy));
			d.deps.editor().panned();
		}
		return step;
	};

	const { releaseCarried, onTouchMove, onTouchEnd, beginTouch } = createFingerPress({
		carried,
		touch,
		fingerOf,
		keptTouches,
		outer: d,
		touches,
		get caught() {
			return caught;
		},
		set caught(next) {
			caught = next;
		},
	});

	watchLostTouches({
		carried,
		touches,
		releaseCarried,
		claimed,
		outer: d,
		onTouchMove,
		onTouchEnd,
	});

	return {
		keptTouches,
		touches,
		claimed,
		get poolPans() {
			return poolPans;
		},
		set poolPans(next) {
			poolPans = next;
		},
		get caught() {
			return caught;
		},
		set caught(next) {
			caught = next;
		},
		beginTouch,
	};
}
