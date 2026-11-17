import type { Camera } from "@decks/protocol";
import { createSignal, onCleanup, onMount } from "solid-js";
import { touchedCanvas } from "../camera/touched.ts";
import { type Viewport } from "../camera/camera.ts";
import type { CameraController } from "../camera/controller.ts";
import { checkCanvasOrigin } from "../camera/coords.ts";
import type { CanvasEditor } from "../edit/dom/index.ts";
import type { CanvasViewProps } from "./CanvasView.tsx";
import { createFingers } from "./fingers.ts";
import { createWheel } from "./wheel.ts";
import { listenKeys } from "./keys.ts";
import { listenSafariPinch } from "./safari-pinch.ts";
import { holdBrowserScroll } from "./browser-holds.ts";
import { createShortcut } from "./key-shortcuts.ts";
import { createHand } from "./hand.ts";
import { createPresses } from "./presses.ts";



/** What the stage's input needs of the stage around it. */
export type ViewInputDeps = {
	props: CanvasViewProps;
	/** The stage element, set once it is mounted. */
	element: () => HTMLDivElement;
	ctl: CameraController;
	view: () => Viewport;
	/** Fit boxes into the canvas column (`CanvasView.tsx`, `frame`). */
	frame: (boxes: Array<{ x: number; y: number; w: number; h: number }>) => Camera;
	/** The editor, made after the input: read only once the stage is running. */
	editor: () => CanvasEditor;
	/** The stage scrolled: the camera follows (`CanvasView.tsx`, `scrolled`). */
	scrolled: () => void;
	/** The stage's size, measured on mount and whenever it changes. */
	measured: (viewport: Viewport) => void;
	/** A sideways scroll over a card's wide table (`penLayer.scrollBy`): whether something took it. */
	scrollBy: (at: { x: number; y: number }, by: number) => boolean;
	worldAt: (event: { clientX: number; clientY: number }) => { x: number; y: number };
};

/**
 * What the stage hears from the person: the DOM listeners set up on mount, the wheel and the
 * trackpad, fingers and their pinch, the scroll the camera follows, the camera's keys, and whether a
 * press is held. Made inside `CanvasView`, so its effects and listeners belong to the stage.
 */
export function createViewInput(deps: ViewInputDeps) {
	const { props, ctl, view, frame, worldAt } = deps;
	const el = deps.element;
	const { setPanning } = ctl;

	const [spaceHeld, setSpaceHeld] = createSignal(false);
	const held = createHand({
		spaceHeld,
		el,
		get panFrom() {
			return panFrom;
		},
	});
	const { COAST_MS, grabbing, pressHeld } = held;
	onMount(() => {
		const element = el();
		const editor = deps.editor();
		// A hand on the canvas holds the view against an agent's show (`camera/touched.ts`).
		for (const kind of ["pointerdown", "wheel", "keydown"] as const) element.addEventListener(kind, touchedCanvas, { capture: true, passive: true });
		onCleanup(() => {
			for (const kind of ["pointerdown", "wheel", "keydown"] as const) element.removeEventListener(kind, touchedCanvas, { capture: true });
		});
		holdBrowserScroll({
			element,
			get lastScroll() {
				return held.lastScroll;
			},
			set lastScroll(next) {
				held.lastScroll = next;
			},
			deps,
			get keptTouches() {
				return keptTouches;
			},
		});
		listenSafariPinch({
			get touches() {
				return touches;
			},
			get wheeling() {
				return wheeling;
			},
			element,
			get pushCamera() {
				return pushCamera;
			},
			ctl,
			view,
			get stoppedMoving() {
				return stoppedMoving;
			},
		});
		const measure = () => deps.measured({ width: element.clientWidth, height: element.clientHeight });
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		measure();
		// Everything on the canvas assumes a stage pixel is a client pixel; say so if it is not.
		checkCanvasOrigin(element);
		onCleanup(() => observer.disconnect());

		listenKeys({
			get pushCamera() {
				return pushCamera;
			},
			frame,
			props,
			ctl,
			view,
			get centre() {
				return centre;
			},
			editor,
			setSpaceHeld,
			get shortcut() {
				return shortcut;
			},
		});
	});

	const centre = () => ({ x: view().width / 2, y: view().height / 2 });

	// Moving the camera: the controller's (`camera/controller.ts`).
	const { push: pushCamera, cancelCoast, stopped: stoppedMoving } = ctl;

	const { shortcut } = createShortcut({
		props,
		pushCamera,
		frame,
		ctl,
		view,
		centre,
	});

	const wheeling = createWheel({
		ctl,
		props,
		deps,
		worldAt,
		view,
		el,
	});
	const { onWheel } = wheeling;

	/**
	 * A press on a drawn item's click shape (`render/engine.ts`, `attachHits`). Only items over a board have one, to take
	 * the press from the board's page; on bare canvas the press is the stage's and `pickAt` finds the item.
	 */
	const onDrawn = (target: EventTarget | null) => !!(target as Element | null)?.closest?.(".pen-hits");
	/** Bare canvas or something drawn on it: either way not a board, and the canvas's to handle. */
	const onCanvas = (target: EventTarget | null) => target === el() || onDrawn(target);

	const fingers = createFingers({
		cancelCoast,
		setPanning,
		ctl,
		stoppedMoving,
		pushCamera,
		view,
		deps,
		onCanvas,
		props,
		get lastScroll() {
			return held.lastScroll;
		},
		COAST_MS,
		el,
	});
	const { keptTouches, touches, claimed, beginTouch } = fingers;

	const { panFrom, gestures } = createPresses({
		claimed,
		keptTouches,
		touches,
		fingers,
		el,
		props,
		setPanning,
		pushCamera,
		ctl,
		deps,
	});

	return { grabbing, pressHeld, onWheel, touches, claimed, keptTouches, beginTouch, panFrom, gestures, caught: () => fingers.caught };
}
