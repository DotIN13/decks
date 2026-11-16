import { knobs } from "../debug.ts";
import type { Camera } from "@decks/protocol-old";
import { createSignal, onCleanup, onMount } from "solid-js";
import { touchedCanvas } from "../camera/hands-on.ts";
import { boxOf, pan, pinchCamera, zoomAbout, type Viewport } from "../camera/camera.ts";
import type { CameraController } from "../camera/controller.ts";
import { checkStageOrigin, stagePoint } from "../camera/coords.ts";
import { zoomKey } from "../camera/zoom-keys.ts";
import { createTouches, type Finger, type TouchStep } from "../camera/touch.ts";
import { handTool } from "../editor/pen-tools.ts";
import { handPans } from "../editor/core/dispatch.ts";
import { untilReleased } from "../editor/held.ts";
import { onCanvas } from "./press-target.ts";
import type { StageEditor } from "../editor/index.ts";
import type { ItemSlotProps } from "../items/item-slot.tsx";
import type { StageProps } from "../view/CanvasView.tsx";


/**
 * `v`, select: the one palette key left. The tools that add things are the stage's own now, armed
 * by `PEN_TOOL_KEYS` (`editor/pen-tools.ts`); the ones that inserted components into a board are gone.
 */
const TOOL_KEYS: Record<string, "select"> = { v: "select" };

/** What the stage's input needs of the stage around it. */
type StageInputDeps = {
	props: StageProps;
	/** The stage element, set once it is mounted. */
	element: () => HTMLDivElement;
	ctl: CameraController;
	view: () => Viewport;
	/** Fit boxes into the canvas column (`CanvasView.tsx`, `frame`). */
	frame: (boxes: Array<{ x: number; y: number; w: number; h: number }>) => Camera;
	/** The editor, made after the input: read only once the stage is running. */
	editor: () => StageEditor;
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
 * press is held. Made inside `Stage`, so its effects and listeners belong to the stage.
 */
export function createStageInput(deps: StageInputDeps) {
	const { ctl } = deps;
	const [spaceHeld, setSpaceHeld] = createSignal(false);
	/** A press is held on the canvas (not on a pill): the drawn items' pill steps aside until it lets go. */
	const [pressHeld, setPressHeld] = createSignal(false);
	const c: InputCtx = {
		deps,
		props: deps.props,
		ctl,
		view: deps.view,
		frame: deps.frame,
		worldAt: deps.worldAt,
		el: deps.element,
		setPanning: ctl.setPanning,
		// Moving the camera: the controller's (`camera/controller.ts`).
		pushCamera: ctl.push,
		cancelCoast: ctl.cancelCoast,
		stoppedMoving: ctl.stopped,
		wheel: ctl.wheel,
		local: stagePoint,
		spaceHeld,
		setSpaceHeld,
		pressHeld,
		setPressHeld,
		lastScroll: 0,
		gesturing: false,
		nativeWheel: typeof localStorage !== "undefined" && localStorage.getItem("decks.nativeWheel") === "1",
		wheelCarry: { x: 0, y: 0 },
		touches: createTouches(),
		keptTouches: new KeptTouches(),
		claimed: new Set<number>(),
		carried: new Set<number>(),
		pinched: false,
		caught: false,
		poolPans: false,
		panned: [],
		touchMove: (event) => onTouchMove(c, event),
		touchEnd: (event) => onTouchEnd(c, event),
	};
	onMount(() => listenPresses(c, c.el()));
	onMount(() => {
		const element = c.el();
		listenCanvas(c, element);
		holdTouches(c, element);
		listenGestures(c, element);
		measureCanvas(c, element);
		listenKeys(c, c.deps.editor());
	});
	listenLost(c);
	return {
		grabbing: () => grabbing(c),
		pressHeld,
		onWheel: (event: WheelEvent) => onWheel(c, event),
		touches: c.touches,
		claimed: c.claimed,
		keptTouches: c.keptTouches,
		beginTouch: (event: PointerEvent) => beginTouch(c, event),
		panFrom: (event: PointerEvent, how: { deselect: boolean; middle: boolean }) => panFrom(c, event, how),
		gestures: gesturesOf(c),
		caught: () => c.caught,
	};
}

/** What the input keeps while the canvas lives, handed to each of its parts. */
type InputCtx = {
	deps: StageInputDeps;
	props: StageProps;
	ctl: CameraController;
	view: () => Viewport;
	frame: (boxes: Array<{ x: number; y: number; w: number; h: number }>) => Camera;
	worldAt: (event: { clientX: number; clientY: number }) => { x: number; y: number };
	el: () => HTMLDivElement;
	setPanning: CameraController["setPanning"];
	pushCamera: CameraController["push"];
	cancelCoast: CameraController["cancelCoast"];
	stoppedMoving: CameraController["stopped"];
	/** A wheel or a trackpad's pinch, already in stage coordinates (`camera/controller.ts`). */
	wheel: CameraController["wheel"];
	/** Where the pointer is, in stage coordinates, which are the event's own client ones (`camera/coords.ts`). */
	local: (event: { clientX: number; clientY: number }) => { x: number; y: number };
	spaceHeld: () => boolean;
	setSpaceHeld: (held: boolean) => void;
	pressHeld: () => boolean;
	setPressHeld: (held: boolean) => void;
	/** When the stage last scrolled: within `COAST_MS` of it, with no finger down, the browser is still coasting after a flick. */
	lastScroll: number;
	/** Safari's pinch is under way (`gesturechange`): a wheel it may send beside it is not a second zoom. */
	gesturing: boolean;
	/** `decks.nativeWheel` = "1" in localStorage leaves a two-finger scroll to the browser, for measuring. */
	nativeWheel: boolean;
	/** What the wheel's steps have asked for and the scroll has not taken yet, below a pixel, so a slow diagonal pans the fingers' way. */
	wheelCarry: { x: number; y: number };
	/** Every finger on the canvas: two are one pinch, the canvas's own (`camera/touch.ts`). */
	touches: ReturnType<typeof createTouches>;
	/** Fingers whose press the editor took (`keepTouch`): their touch is kept from scrolling the stage. */
	keptTouches: KeptTouches;
	/** Fingers claimed by what they landed on (an item carried by its bar or edge): the camera does not pan with them. */
	claimed: Set<number>;
	/** Fingers this document is carrying. */
	carried: Set<number>;
	/** The gesture so far has been a pinch: its lift ends the moving state at once (`stoppedMoving`). */
	pinched: boolean;
	/** The first finger landed on a moving canvas and caught it: until it lifts this pool pans for it. */
	caught: boolean;
	/** A finger landed on a card's cover: until the last finger lifts this pool pans for it, and a throw coasts. */
	poolPans: boolean;
	/** The pool's last pan steps, for the coast after a throw: stage pixels and when. */
	panned: Array<{ t: number; dx: number; dy: number }>;
	/** The window's listeners for the fingers carried, kept so they can be taken off again. */
	touchMove: (event: PointerEvent) => void;
	touchEnd: (event: PointerEvent) => void;
};

/** A browser coast after a flick runs this long after the last scroll. */
const COAST_MS = 100;

// Listening while the canvas lives: presses, the canvas element, held touches, gestures, size, keys, lost hands.
/** A press held on the canvas, for the pill to step aside; and the hand or Space pans from a press anywhere. */
function listenPresses(c: InputCtx, element: HTMLDivElement): void {
	const press = (event: PointerEvent) => {
		if (!(event.target as Element | null)?.closest?.(".card-callout")) c.setPressHeld(true);
	};
	const release = () => c.setPressHeld(false);
	element.addEventListener("pointerdown", press, { capture: true, passive: true });
	/*
	 * The hand (or Space held) pans from a press anywhere on the stage, whatever is selected: on an
	 * item's bar or edge, a handle, a grip or an anchor too, which otherwise would carry, size or join
	 * it (`core/dispatch.ts`, `handPans`). Taken here, before any of them hears the press. A press on
	 * bare stage goes on to the editor, which pans it already. A card's page is a frame of its own and
	 * never sends its presses here, so words in it still select.
	 */
	const hand = (event: PointerEvent) => {
		const target = event.target as Element | null;
		if (target === element) return;
		const control = !!target?.closest?.("button, input, textarea, select, a[href], [contenteditable]:not([contenteditable='false']), [role=button], [role=menu], .pen-text");
		if (!handPans({ hand: grabbing(c), pointer: event.pointerType === "touch" ? "touch" : event.pointerType === "pen" ? "pen" : "mouse", button: event.button, control })) return;
		event.stopPropagation();
		panFrom(c, event, { deselect: false, middle: false });
	};
	element.addEventListener("pointerdown", hand, { capture: true });
	window.addEventListener("pointerup", release, true);
	window.addEventListener("pointercancel", release, true);
	onCleanup(() => {
		element.removeEventListener("pointerdown", press, { capture: true });
		element.removeEventListener("pointerdown", hand, { capture: true });
		window.removeEventListener("pointerup", release, true);
		window.removeEventListener("pointercancel", release, true);
	});
}

/** A hand on the canvas holds an agent's show; a pinch elsewhere does nothing; the camera follows the scroll; the scroll keys are the canvas's. */
function listenCanvas(c: InputCtx, element: HTMLDivElement): void {
	// A hand on the canvas holds the view against an agent's show (`camera/hands-on.ts`).
	for (const kind of ["pointerdown", "wheel", "keydown"] as const) element.addEventListener(kind, touchedCanvas, { capture: true, passive: true });
	onCleanup(() => {
		for (const kind of ["pointerdown", "wheel", "keydown"] as const) element.removeEventListener(kind, touchedCanvas, { capture: true });
	});
	/*
	 * A pinch over anything that is not the canvas (the toolbars, the composer, the conversation,
	 * the panels, a dialog) does nothing. Chrome sends a trackpad pinch as a wheel event with
	 * `ctrlKey`, and one nobody cancels zooms the whole page. The canvas zooms only for a pinch
	 * over the stage itself (`onWheel`).
	 */
	const pinchOver = (event: WheelEvent) => {
		if (event.ctrlKey && !element.contains(event.target as Node | null)) event.preventDefault();
	};
	window.addEventListener("wheel", pinchOver, { capture: true, passive: false });
	onCleanup(() => window.removeEventListener("wheel", pinchOver, { capture: true }));
	// The stage scrolled: the camera follows (`CanvasView.tsx`, `scrolled`).
	const onScroll = () => {
		c.lastScroll = performance.now();
		c.deps.scrolled();
	};
	element.addEventListener("scroll", onScroll, { passive: true });
	onCleanup(() => element.removeEventListener("scroll", onScroll));
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
	element.addEventListener("keydown", holdScrollKeys);
	onCleanup(() => element.removeEventListener("keydown", holdScrollKeys));
}

/** Fingers the editor kept, and two fingers, are held from the browser's scroll; a kept finger lets go when it lifts. */
function holdTouches(c: InputCtx, element: HTMLDivElement): void {
	/*
	 * A finger on an item, a handle or a board is the editor's: its touch must not scroll the stage.
	 * The pointer event comes first and says so (`keepTouch`); cancelling the touch's start is what
	 * keeps the browser from taking it. Every other finger is left to scroll natively.
	 */
	const holdTouch = (event: TouchEvent) => {
		if (c.keptTouches.size > 0) event.preventDefault();
	};
	element.addEventListener("touchstart", holdTouch, { passive: false });
	onCleanup(() => element.removeEventListener("touchstart", holdTouch));
	/*
	 * A finger kept after it landed (a hold, `pointer.ts`): its touch began as the browser's, so its moves
	 * are held back too, by a listener there only while a finger is kept, so a plain pan never waits for
	 * the page. The browser has not begun to scroll a finger that stayed within its slop.
	 */
	const holdMove = (event: TouchEvent) => {
		if (c.keptTouches.size > 0 && event.cancelable) event.preventDefault();
	};
	let holdingMoves = false;
	c.keptTouches.changed = () => {
		const want = c.keptTouches.size > 0;
		if (want === holdingMoves) return;
		holdingMoves = want;
		if (want) element.addEventListener("touchmove", holdMove, { passive: false });
		else element.removeEventListener("touchmove", holdMove);
	};
	onCleanup(() => {
		c.keptTouches.changed = undefined;
		element.removeEventListener("touchmove", holdMove);
	});
	// A kept finger lets go when it lifts, wherever it was kept: one left behind would hold every later touch from scrolling.
	const letGo = (event: PointerEvent) => c.keptTouches.delete(event.pointerId);
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
		if (two) element.addEventListener("touchmove", holdScroll, { passive: false });
		else element.removeEventListener("touchmove", holdScroll);
	};
	for (const kind of ["touchstart", "touchend", "touchcancel"] as const) element.addEventListener(kind, twoFingers, { passive: true });
	onCleanup(() => {
		for (const kind of ["touchstart", "touchend", "touchcancel"] as const) element.removeEventListener(kind, twoFingers);
		element.removeEventListener("touchmove", holdScroll);
	});
}

/** Safari's gesture events: the pinch, when the canvas's own two fingers do not have it. */
function listenGestures(c: InputCtx, element: HTMLDivElement): void {
	/**
	 * The canvas's pinch has two fingers: a gesture event is about them and changes nothing. With fewer
	 * (the first finger already taken by the browser's scroll, which cancels its pointer, or a trackpad)
	 * the gesture events are the pinch.
	 */
	const fingersDown = () => c.touches.count() >= 2;
	let gestureScale = 1;
	let stageAt = { left: 0, top: 0 };
	const onGestureStart = (event: Event) => {
		event.preventDefault();
		gestureScale = 1;
		c.gesturing = true;
		if (fingersDown()) return;
		const r = element.getBoundingClientRect();
		stageAt = { left: r.left, top: r.top };
	};
	const onGestureChange = (event: Event) => {
		event.preventDefault();
		const g = event as Event & { scale: number; clientX: number; clientY: number };
		const factor = g.scale / gestureScale;
		// Followed even while the canvas's pinch has the fingers, so handing back to these events does not jump.
		gestureScale = g.scale;
		if (fingersDown() || !Number.isFinite(factor) || factor <= 0 || factor === 1) return;
		c.pushCamera(zoomAbout(c.ctl.now(), c.view(), { x: g.clientX - stageAt.left, y: g.clientY - stageAt.top }, factor));
	};
	const onGestureEnd = (event: Event) => {
		event.preventDefault();
		c.gesturing = false;
		if (fingersDown()) return;
		c.stoppedMoving();
	};
	element.addEventListener("gesturestart", onGestureStart, { passive: false });
	element.addEventListener("gesturechange", onGestureChange, { passive: false });
	element.addEventListener("gestureend", onGestureEnd, { passive: false });
	onCleanup(() => {
		element.removeEventListener("gesturestart", onGestureStart);
		element.removeEventListener("gesturechange", onGestureChange);
		element.removeEventListener("gestureend", onGestureEnd);
	});
}

/** The stage's size, measured now and whenever it changes. */
function measureCanvas(c: InputCtx, element: HTMLDivElement): void {
	const measure = () => c.deps.measured({ width: element.clientWidth, height: element.clientHeight });
	const observer = new ResizeObserver(measure);
	observer.observe(element);
	measure();
	// Everything on the canvas assumes a stage pixel is a client pixel; say so if it is not.
	checkStageOrigin(element);
	onCleanup(() => observer.disconnect());
}

/** The canvas's keys while the stage lives: onKeyDown, and Space let go. */
function listenKeys(c: InputCtx, editor: StageEditor): void {
	const keydown = (event: KeyboardEvent) => onKeyDown(c, editor, event);
	const keyup = (event: KeyboardEvent) => {
		if (event.code === "Space") c.setSpaceHeld(false);
	};
	addEventListener("keydown", keydown);
	addEventListener("keyup", keyup);
	onCleanup(() => {
		removeEventListener("keydown", keydown);
		removeEventListener("keyup", keyup);
	});
}

/** A key on the canvas: zoom keys first wherever the caret is, then the drawing's keys, Space to pan, and the camera's shortcuts. */
function onKeyDown(c: InputCtx, editor: StageEditor, event: KeyboardEvent): void {
		/*
		 * ⌘+ / ⌘− / ⌘0, before every other guard in this function.
		 *
		 * Above the typing check as well as the modifier one, because these mean the same
		 * thing wherever the caret is: they do nothing useful in a text field, and the
		 * caret is in the composer most of the time — a zoom that stopped working as soon
		 * as you clicked the input would be the bug in a smaller costume.
		 *
		 * These are the one place a person's habit and the browser's collide. On a canvas
		 * ⌘+ means "zoom in"; Chrome hears "make the page bigger", which enlarges the whole
		 * app — chat column, chrome and all — and leaves the camera exactly where it was.
		 * So they are taken here and the browser's page zoom is declined.
		 *
		 * `zoom-keys.ts` decides which keystroke this is, because the answer is not the
		 * obvious one: the key labelled `+` is `=` unshifted, so matching `"+"` misses
		 * every press that is not on the numpad.
		 */
		const zoom = zoomKey(event);
		if (zoom) {
			if (zoom === "fit") c.pushCamera(c.frame(c.props.boards.map(boxOf)));
			else c.pushCamera(zoomAbout(c.ctl.now(), c.view(), centre(c), zoom === "in" ? 1.2 : 1 / 1.2));
			event.preventDefault();
			return;
		}
		const typing = (event.target as HTMLElement | null)?.closest("input, textarea, [contenteditable]");
		if (typing) return;
		/*
		 * The drawing's own keys, in either mode but not while drawing. None of them fire while a text box has the caret
		 * (above). Delete, the arrows and ⌘D act on what is selected; ⌘Z and ⇧⌘Z step through the
		 * person's own edits; Escape lets go, then puts the tool down; a letter arms a tool
		 * (`PEN_TOOL_KEYS`), from this document only.
		 */
		if (editor.key(event)) {
			event.preventDefault();
			return;
		}
		/*
		 * A key with a modifier on it is not one of ours.
		 *
		 * Every shortcut here is a bare key — `V S C T E` for the tools, `0 1 + -` for
		 * the camera — and none of them wanted a modifier. Without this check the letters
		 * matched anyway, so **⌘C stopped copying**: `event.key` is `"c"` whatever else is
		 * held, so a copy switched the tool to *card* and then `preventDefault()` cancelled
		 * the clipboard. Selecting a line of a reply and copying it did nothing at all, and
		 * ⌘V, ⌘S, ⌘E and ⌘0 were quietly taken the same way. Space is inside the guard
		 * too, because ⌘Space belongs to the OS.
		 */
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		if (event.code === "Space") {
			c.setSpaceHeld(true);
			event.preventDefault();
			return;
		}
		if (shortcut(c, event.key)) event.preventDefault();
}

/** The whole hand lost to the tab going away or the window losing focus, and the window's finger listeners taken off at the end. */
function listenLost(c: InputCtx): void {
	const blur = () => onBlur(c);
	const hidden = () => onHidden(c);
	window.addEventListener("blur", blur);
	document.addEventListener("visibilitychange", hidden);
	onCleanup(() => {
		window.removeEventListener("blur", blur);
		document.removeEventListener("visibilitychange", hidden);
		window.removeEventListener("pointermove", c.touchMove);
		window.removeEventListener("pointerup", c.touchEnd);
		window.removeEventListener("pointercancel", c.touchEnd);
	});
}

// Keys, the wheel and the trackpad.
/** A press pans: Space is held, or the host's hand tool is on (`editor/pen-tools.ts`). */
function grabbing(c: InputCtx) {
	return c.spaceHeld() || handTool();
}

function centre(c: InputCtx) {
	return { x: c.view().width / 2, y: c.view().height / 2 };
}

/**
 * The camera shortcuts, and the palette's one key, in one place. Returns whether the key meant
 * anything, so the caller knows to swallow it.
 */
function shortcut(c: InputCtx, key: string): boolean {
	const tool = TOOL_KEYS[key];
	if (tool && c.props.onTool) {
		c.props.onTool(tool);
		return true;
	}
	switch (key) {
		case "0":
			c.pushCamera(c.frame(c.props.boards.map(boxOf)));
			return true;
		case "1": {
			const board = c.props.boards.find((candidate) => candidate.path === c.props.selected) ?? c.props.boards[0];
			if (board) c.pushCamera(c.frame([boxOf(board)]));
			return true;
		}
		case "+":
		case "=":
			c.pushCamera(zoomAbout(c.ctl.now(), c.view(), centre(c), 1.2));
			return true;
		case "-":
			c.pushCamera(zoomAbout(c.ctl.now(), c.view(), centre(c), 1 / 1.2));
			return true;
		default:
			return false;
	}
}

function onWheel(c: InputCtx, event: WheelEvent) {
	const zooming = event.ctrlKey || event.metaKey;
	if (zooming && c.gesturing) {
		event.preventDefault();
		return;
	}
	/*
	 * A sideways scroll over a card's wide table scrolls the table, as it would in a page; Shift and
	 * a wheel is sideways too.
	 */
	if (!zooming && c.props.pen && !c.props.drawing) {
		const sideways = event.shiftKey && event.deltaX === 0 ? event.deltaY : Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : 0;
		if (sideways !== 0 && c.deps.scrollBy(c.worldAt(event), sideways / c.ctl.now().zoom)) {
			event.preventDefault();
			return;
		}
	}
	/*
	 * A two-finger scroll moves the stage by the wheel's own deltas, and the camera follows from the
	 * scroll event (`onScroll`). Left to the browser, a trackpad's scroll and its momentum are held to
	 * an axis whenever they run near one (Chrome's rails on a Mac, within about 27 degrees; Safari
	 * drops the smaller delta), so a flick went only a few ways. The deltas a page is given are the
	 * trackpad's own. `decks.nativeWheel` = "1" in localStorage leaves it to the browser, for measuring.
	 */
	if (!zooming) {
		if (c.nativeWheel) return;
		event.preventDefault();
		const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? c.view().height : 1;
		// Shift turns a mouse wheel sideways, as the browser would have.
		const dx = (event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX) * unit;
		const dy = (event.shiftKey && event.deltaX === 0 ? 0 : event.deltaY) * unit;
		c.wheelCarry.x += dx;
		c.wheelCarry.y += dy;
		const left = Math.trunc(c.wheelCarry.x);
		const top = Math.trunc(c.wheelCarry.y);
		c.wheelCarry.x -= left;
		c.wheelCarry.y -= top;
		if (left !== 0 || top !== 0) c.el().scrollBy({ left, top, behavior: "instant" });
		return;
	}
	event.preventDefault();
	const at = c.local(event);
	// `ctrlKey` is a trackpad pinch, not a key anybody pressed; `metaKey` is the
	// deliberate mouse-wheel zoom. Everything else is a two-finger scroll.
	c.wheel({ x: at.x, y: at.y, deltaX: event.deltaX, deltaY: event.deltaY, zooming: event.ctrlKey || event.metaKey, pinch: event.ctrlKey && !event.metaKey });
}

// Fingers: the pool, carrying them, catching a moving canvas, losing them, and what an item's slot asks.


/** A finger, in the stage's own coordinates: the space the camera works in. */
function fingerOf(c: InputCtx, event: PointerEvent): Finger {
	const at = stagePoint(event);
	return { id: event.pointerId, x: at.x, y: at.y };
}

/** One finger's worth of a gesture. A one-finger pan is the browser's scroll, so only a pinch moves the camera here. */
function touch(c: InputCtx, phase: "down" | "move" | "up", finger: Finger): TouchStep {
	// For the checks: every step of the pool, when asked for (`knobs.touchLog`).
	const log = knobs.touchLog;
	if (log) log.push({ phase, id: finger.id, x: Math.round(finger.x), y: Math.round(finger.y), count: c.touches.count(), claimed: c.claimed.size, kept: c.keptTouches.size, t: Math.round(performance.now()) });
	if (phase === "down") {
		// A finger on the glass stops a coast, the way a hand stops a spinning list.
		c.cancelCoast();
		c.touches.down(finger);
		if (c.touches.count() === 1) {
			c.pinched = false;
			c.panned.length = 0;
		}
		c.setPanning(true);
		return { kind: "idle" };
	}
	if (phase === "up") {
		c.touches.up(finger.id);
		c.claimed.delete(finger.id);
		if (c.touches.count() === 0) {
			// A throw the pool panned for coasts on, as the browser's own scroll would (the last 100 ms of it).
			const now = performance.now();
			const recent = c.panned.filter((one) => now - one.t < 100);
			if ((c.caught || c.poolPans) && !c.pinched && recent.length > 1 && now - recent.at(-1)!.t < 60) {
				const span = Math.max(16, recent.at(-1)!.t - recent[0]!.t);
				const vx = recent.slice(1).reduce((sum, one) => sum + one.dx, 0) / span;
				const vy = recent.slice(1).reduce((sum, one) => sum + one.dy, 0) / span;
				if (Math.hypot(vx, vy) > 0.05) c.ctl.coast({ vx, vy });
			}
			c.panned.length = 0;
			c.caught = false;
			c.poolPans = false;
			c.setPanning(false);
			if (c.pinched && !knobs.pinchTail) c.stoppedMoving();
		}
		return { kind: "idle" };
	}

	const step = c.touches.move(finger);
	if (log) log.push({ phase: "step", id: finger.id, kind: step.kind, t: Math.round(performance.now()) });
	if (step.kind === "pinch") {
		c.pinched = true;
		c.claimed.clear();
		c.pushCamera(pinchCamera(c.ctl.now(), c.view(), step.from, step.to));
	} else if (step.kind === "pan" && (c.caught || c.poolPans) && !c.claimed.has(finger.id)) {
		c.panned.push({ t: performance.now(), dx: step.dx, dy: step.dy });
		if (c.panned.length > 12) c.panned.shift();
		c.pushCamera(pan(c.ctl.now(), step.dx, step.dy));
		c.deps.editor().panned();
	}
	return step;
}

function onTouchMove(c: InputCtx, event: PointerEvent) {
	if (!c.carried.has(event.pointerId)) return;
	touch(c, "move", fingerOf(c, event));
}

function onTouchEnd(c: InputCtx, event: PointerEvent) {
	if (!c.carried.has(event.pointerId)) return;
	c.carried.delete(event.pointerId);
	c.keptTouches.delete(event.pointerId);
	touch(c, "up", fingerOf(c, event));
	if (c.carried.size > 0) return;
	window.removeEventListener("pointermove", c.touchMove);
	window.removeEventListener("pointerup", c.touchEnd);
	window.removeEventListener("pointercancel", c.touchEnd);
}

/** Hand back every finger this document is carrying, wherever each one got to. */
function releaseCarried(c: InputCtx) {
	for (const id of [...c.carried]) {
		c.carried.delete(id);
		touch(c, "up", { id, x: 0, y: 0 });
	}
}

function beginTouch(c: InputCtx, event: PointerEvent) {
	// A tap on bare canvas clears the selection, exactly as a click does. Decided on
	// the way down rather than on the way up: a pan that starts on empty stage is not
	// a gesture that wants to keep a component selected either.
	if (onCanvas(c.el(), event.target)) c.props.onSelect(undefined);
	/*
	 * The browser's own word for "nothing else is down": the primary pointer of a
	 * touch sequence is the first finger on the glass. Anything still carried at that
	 * moment never reported its end, so it is dropped here rather than counted as
	 * half of a pinch that is not happening.
	 */
	if (event.isPrimary && c.carried.size > 0) releaseCarried(c);
	if (c.carried.size === 0) {
		/*
		 * On the window, not on the stage. Capture is a nicety that can be refused,
		 * and without it a finger that slides off the canvas — onto the conversation,
		 * the rail, the composer — lifts somewhere this element never hears about,
		 * and the pool keeps it. The handlers ask `carried` which fingers are theirs,
		 * so listening wider costs nothing and closes that gap.
		 */
		window.addEventListener("pointermove", c.touchMove);
		window.addEventListener("pointerup", c.touchEnd);
		window.addEventListener("pointercancel", c.touchEnd);
	}
	c.carried.add(event.pointerId);
	/*
	 * A finger landing on a moving canvas catches it, as a hand catches a spinning list: an agent's
	 * glide stops where it is, and the browser's own coast after a flick is not given the finger to
	 * carry on with (`holdTouch` cancels its touch start, as for a kept finger), or on an iPad the
	 * fingers that followed stayed the scroll's and no pinch could begin until it had run down. The
	 * pool pans for the finger instead (`touch`, `caught`), and a second finger is a pinch as ever.
	 */
	if (c.touches.count() === 0) {
		c.caught = c.ctl.gliding() || performance.now() - c.lastScroll < COAST_MS;
		if (c.caught) {
			c.ctl.cancelGlide();
			c.keptTouches.add(event.pointerId);
		}
	}
	touch(c, "down", fingerOf(c, event));
	try {
		c.el().setPointerCapture(event.pointerId);
	} catch {
		// Capture is per-pointer and can be refused; the listeners above still carry
		// the gesture for as long as the finger stays over the stage.
	}
}

/**
 * The whole hand, gone: the tab went to the background, or the OS took the gesture.
 *
 * Neither of those ends a touch in a way any document is told about — the events
 * simply stop — so every finger in the pool is released. Without this, backgrounding the
 * tab mid-pan is enough to leave the canvas reading every later touch as a pinch.
 */
function lostTouches(c: InputCtx) {
	if (c.carried.size === 0 && c.touches.count() === 0) return;
	releaseCarried(c);
	for (const id of c.touches.ids()) c.touches.up(id);
	c.claimed.clear();
	c.setPanning(false);
}

function onHidden(c: InputCtx) {
	if (document.visibilityState === "hidden") lostTouches(c);
}

/*
 * Focus moving into a card's field, or another frame, blurs this window too, and that happens on
 * an ordinary tap — so a bare `blur` handler would throw the gesture away as it began.
 * `document.hasFocus()` is the difference: it counts a nested frame as this document having focus,
 * and is false only when the browser or the tab really has lost it.
 */
function onBlur(c: InputCtx) {
	if (document.hasFocus()) return;
	lostTouches(c);
}

/** What an item's slot asks of the stage's fingers: a finger its bar or edge took carries the item, and the camera does not pan with it. */
function gesturesOf(c: InputCtx): ItemSlotProps["gestures"] {
	return {
		claimTouch: (id) => {
			c.claimed.add(id);
			c.keptTouches.add(id);
		},
		pinching: () => c.touches.count() > 1,
		panTouch: (id) => {
			c.poolPans = true;
			c.keptTouches.add(id);
		},
		caught: () => c.caught,
	};
}

// The camera dragged from a press.
/**
 * The camera dragged from a press (`editor/core/dispatch.ts`, `pan`): with the middle button, with
 * Space held, or on bare canvas, which lets the selected board go (`deselect`).
 */
function panFrom(c: InputCtx, event: PointerEvent, how: { deselect: boolean; middle: boolean }) {
	const { middle } = how;
	event.preventDefault();
	const element = c.el();
	if (how.deselect) c.props.onSelect(undefined);
	element.setPointerCapture(event.pointerId);
	c.setPanning(true);

	let last = { x: event.clientX, y: event.clientY };
	const move = (moveEvent: PointerEvent) => {
		c.pushCamera(pan(c.ctl.now(), moveEvent.clientX - last.x, moveEvent.clientY - last.y));
		last = { x: moveEvent.clientX, y: moveEvent.clientY };
		c.deps.editor().panned();
	};
	// Ended on any sign the button is up, not only its release (`held.ts`).
	const stop = untilReleased({ docs: [document], held: middle ? 4 : 1, capture: element, end: () => finish() });
	const finish = () => {
		stop();
		element.removeEventListener("pointermove", move);
		c.setPanning(false);
	};
	element.addEventListener("pointermove", move);
}

/** The fingers whose touch is kept from the browser's scroll, saying when that changes (`holdMove`). */
class KeptTouches extends Set<number> {
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
