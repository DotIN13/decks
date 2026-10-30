import type { Camera } from "@decks/protocol";
import { createSignal, onCleanup, onMount } from "solid-js";
import { touchedCanvas } from "../camera/touched.ts";
import { boxOf, pan, pinchCamera, zoomAbout, type Viewport } from "../camera/camera.ts";
import type { CameraController } from "../camera/controller.ts";
import { checkStageOrigin, stagePoint } from "../camera/coords.ts";
import { zoomKey } from "../camera/zoom-keys.ts";
import { createTouches, type Finger, type TouchStep } from "../camera/touch.ts";
import { handTool } from "../edit/pen-tools.ts";
import { untilReleased } from "../edit/held.ts";
import type { StageEditor } from "../edit/index.ts";
import type { StageBoardProps } from "../items/item-slot.tsx";
import type { StageProps } from "./Stage.tsx";


/**
 * `v`, select: the one palette key left. The tools that add things are the stage's own now, armed
 * by `PEN_TOOL_KEYS` (`state/pen-tools.ts`); the ones that inserted components into a board are gone.
 */
const TOOL_KEYS: Record<string, "select"> = { v: "select" };

/** What the stage's input needs of the stage around it. */
export type StageInputDeps = {
	props: StageProps;
	/** The stage element, set once it is mounted. */
	element: () => HTMLDivElement;
	ctl: CameraController;
	view: () => Viewport;
	/** Fit boxes into the canvas column (`Stage.tsx`, `frame`). */
	frame: (boxes: Array<{ x: number; y: number; w: number; h: number }>) => Camera;
	/** The editor, made after the input: read only once the stage is running. */
	editor: () => StageEditor;
	/** The stage scrolled: the camera follows (`Stage.tsx`, `scrolled`). */
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
	const { props, ctl, view, frame, worldAt } = deps;
	const el = deps.element;
	const { setPanning } = ctl;

	const [spaceHeld, setSpaceHeld] = createSignal(false);
	/** A press pans: Space is held, or the host's hand tool is on (`state/pen-tools.ts`). */
	const grabbing = () => spaceHeld() || handTool();

	/** A press is held on the canvas (not on a pill): the drawn items' pill steps aside until it lets go. */
	const [pressHeld, setPressHeld] = createSignal(false);
	onMount(() => {
		const element = el();
		const press = (event: PointerEvent) => {
			if (!(event.target as Element | null)?.closest?.(".board-callout")) setPressHeld(true);
		};
		const release = () => setPressHeld(false);
		element.addEventListener("pointerdown", press, { capture: true, passive: true });
		window.addEventListener("pointerup", release, true);
		window.addEventListener("pointercancel", release, true);
		onCleanup(() => {
			element.removeEventListener("pointerdown", press, { capture: true });
			window.removeEventListener("pointerup", release, true);
			window.removeEventListener("pointercancel", release, true);
		});
	});
	onMount(() => {
		const element = el();
		const editor = deps.editor();
		// A hand on the canvas holds the view against an agent's show (`camera/touched.ts`).
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
		// The stage scrolled: the camera follows (`Stage.tsx`, `scrolled`).
		const onScroll = deps.scrolled;
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
		/*
		 * A finger on an item, a handle or a board is the editor's: its touch must not scroll the stage.
		 * The pointer event comes first and says so (`keepTouch`); cancelling the touch's start is what
		 * keeps the browser from taking it. Every other finger is left to scroll natively.
		 */
		const holdTouch = (event: TouchEvent) => {
			if (keptTouches.size > 0) event.preventDefault();
		};
		element.addEventListener("touchstart", holdTouch, { passive: false });
		onCleanup(() => element.removeEventListener("touchstart", holdTouch));
		// A kept finger lets go when it lifts, wherever it was kept: one left behind would hold every later touch from scrolling.
		const letGo = (event: PointerEvent) => keptTouches.delete(event.pointerId);
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
		/**
		 * The canvas's pinch has two fingers: a gesture event is about them and changes nothing. With fewer
		 * (the first finger already taken by the browser's scroll, which cancels its pointer, or a trackpad)
		 * the gesture events are the pinch.
		 */
		const fingersDown = () => touches.count() >= 2;
		let gestureScale = 1;
		let stageAt = { left: 0, top: 0 };
		const onGestureStart = (event: Event) => {
			event.preventDefault();
			gestureScale = 1;
			gesturing = true;
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
			pushCamera(zoomAbout(ctl.now(), view(), { x: g.clientX - stageAt.left, y: g.clientY - stageAt.top }, factor));
		};
		const onGestureEnd = (event: Event) => {
			event.preventDefault();
			gesturing = false;
			if (fingersDown()) return;
			stoppedMoving();
		};
		element.addEventListener("gesturestart", onGestureStart, { passive: false });
		element.addEventListener("gesturechange", onGestureChange, { passive: false });
		element.addEventListener("gestureend", onGestureEnd, { passive: false });
		onCleanup(() => {
			element.removeEventListener("gesturestart", onGestureStart);
			element.removeEventListener("gesturechange", onGestureChange);
			element.removeEventListener("gestureend", onGestureEnd);
		});
		const measure = () => deps.measured({ width: element.clientWidth, height: element.clientHeight });
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		measure();
		// Everything on the canvas assumes a stage pixel is a client pixel; say so if it is not.
		checkStageOrigin(element);
		onCleanup(() => observer.disconnect());

		const keydown = (event: KeyboardEvent) => {
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
				if (zoom === "fit") pushCamera(frame(props.boards.map(boxOf)));
				else pushCamera(zoomAbout(ctl.now(), view(), centre(), zoom === "in" ? 1.2 : 1 / 1.2));
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
				setSpaceHeld(true);
				event.preventDefault();
				return;
			}
			if (shortcut(event.key)) event.preventDefault();
		};
		const keyup = (event: KeyboardEvent) => {
			if (event.code === "Space") setSpaceHeld(false);
		};
		addEventListener("keydown", keydown);
		addEventListener("keyup", keyup);
		onCleanup(() => {
			removeEventListener("keydown", keydown);
			removeEventListener("keyup", keyup);
		});
	});

	const centre = () => ({ x: view().width / 2, y: view().height / 2 });

	// Moving the camera: the controller's (`camera/controller.ts`).
	const { push: pushCamera, cancelCoast, stopped: stoppedMoving } = ctl;

	/**
	 * The camera shortcuts, and the palette's one key, in one place. Returns whether the key meant
	 * anything, so the caller knows to swallow it.
	 */
	const shortcut = (key: string): boolean => {
		const tool = TOOL_KEYS[key];
		if (tool && props.onTool) {
			props.onTool(tool);
			return true;
		}
		switch (key) {
			case "0":
				pushCamera(frame(props.boards.map(boxOf)));
				return true;
			case "1": {
				const board = props.boards.find((candidate) => candidate.path === props.selected) ?? props.boards[0];
				if (board) pushCamera(frame([boxOf(board)]));
				return true;
			}
			case "+":
			case "=":
				pushCamera(zoomAbout(ctl.now(), view(), centre(), 1.2));
				return true;
			case "-":
				pushCamera(zoomAbout(ctl.now(), view(), centre(), 1 / 1.2));
				return true;
			default:
				return false;
		}
	};

	/**
	 * Where the pointer is, in stage coordinates — which are the event's own client ones.
	 *
	 * There was a cached `getBoundingClientRect` here, refreshed every 250 ms, and a
	 * subtraction at each of three call sites. The stage element *is* the viewport, so all of
	 * that was adding zero: `camera/coords.ts` sets out why, and `checkStageOrigin` — called
	 * at mount — is what stops it quietly ceasing to be true.
	 */
	const local = stagePoint;

	/** A wheel or a trackpad's pinch, already in stage coordinates (`camera/controller.ts`). */
	const wheel = ctl.wheel;

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
		if (!zooming && props.pen && !props.drawing) {
			const sideways = event.shiftKey && event.deltaX === 0 ? event.deltaY : Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : 0;
			if (sideways !== 0 && deps.scrollBy(worldAt(event), sideways / ctl.now().zoom)) {
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
			if (nativeWheel) return;
			event.preventDefault();
			const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? view().height : 1;
			// Shift turns a mouse wheel sideways, as the browser would have.
			const dx = (event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX) * unit;
			const dy = (event.shiftKey && event.deltaX === 0 ? 0 : event.deltaY) * unit;
			wheelCarry.x += dx;
			wheelCarry.y += dy;
			const left = Math.trunc(wheelCarry.x);
			const top = Math.trunc(wheelCarry.y);
			wheelCarry.x -= left;
			wheelCarry.y -= top;
			if (left !== 0 || top !== 0) el().scrollBy({ left, top, behavior: "instant" });
			return;
		}
		event.preventDefault();
		const at = local(event);
		// `ctrlKey` is a trackpad pinch, not a key anybody pressed; `metaKey` is the
		// deliberate mouse-wheel zoom. Everything else is a two-finger scroll.
		wheel({ x: at.x, y: at.y, deltaX: event.deltaX, deltaY: event.deltaY, zooming: event.ctrlKey || event.metaKey, pinch: event.ctrlKey && !event.metaKey });
	};

	/**
	 * A press on a drawn item's click shape (`pen/layer.ts`). Only items over a board have one, to take
	 * the press from the board's page; on bare canvas the press is the stage's and `pickAt` finds the item.
	 */
	const onDrawn = (target: EventTarget | null) => !!(target as Element | null)?.closest?.(".pen-hits");
	/** Bare canvas or something drawn on it: either way not a board, and the canvas's to handle. */
	const onCanvas = (target: EventTarget | null) => target === el() || onDrawn(target);

	/**
	 * Every finger on the canvas, and the camera they move.
	 *
	 * Fingers on the stage pan it natively (`camera/scroll-area.ts`): the browser scrolls, and the
	 * camera follows from the scroll. Two are one pinch, the canvas's own (`touch.ts` reduces the pool,
	 * `pinchCamera` moves the camera), wherever each landed: on bare canvas, on a card or on an item's
	 * bar. A finger can be **claimed** by whoever it landed on (an item carried by its bar or its edge):
	 * it still counts towards the pool, so a second finger makes a pinch with the right positions, and a
	 * pinch clears every claim, because zooming out of an item you had started to drag is a change of
	 * mind, not an ambiguity.
	 */
	const touches = createTouches();
	/** Fingers whose press the editor took (`keepTouch`): their touch is kept from scrolling the stage. */
	const keptTouches = new Set<number>();
	const claimed = new Set<number>();
	/** Fingers this document is carrying. */
	const carried = new Set<number>();
	/** The gesture so far has been a pinch: its lift ends the moving state at once (`stoppedMoving`). */
	let pinched = false;
	/** A finger, in the stage's own coordinates: the space the camera works in. */
	const fingerOf = (event: PointerEvent): Finger => {
		const at = stagePoint(event);
		return { id: event.pointerId, x: at.x, y: at.y };
	};

	/** One finger's worth of a gesture. A one-finger pan is the browser's scroll, so only a pinch moves the camera here. */
	const touch = (phase: "down" | "move" | "up", finger: Finger): TouchStep => {
		if (phase === "down") {
			// A finger on the glass stops a coast, the way a hand stops a spinning list.
			cancelCoast();
			touches.down(finger);
			if (touches.count() === 1) pinched = false;
			setPanning(true);
			return { kind: "idle" };
		}
		if (phase === "up") {
			touches.up(finger.id);
			claimed.delete(finger.id);
			if (touches.count() === 0) {
				setPanning(false);
				if (pinched && (globalThis as { __decksPinchTail?: boolean }).__decksPinchTail !== true) stoppedMoving();
			}
			return { kind: "idle" };
		}

		const step = touches.move(finger);
		if (step.kind === "pinch") {
			pinched = true;
			claimed.clear();
			pushCamera(pinchCamera(ctl.now(), view(), step.from, step.to));
		}
		return step;
	};

	const onTouchMove = (event: PointerEvent) => {
		if (!carried.has(event.pointerId)) return;
		touch("move", fingerOf(event));
	};

	const onTouchEnd = (event: PointerEvent) => {
		if (!carried.has(event.pointerId)) return;
		carried.delete(event.pointerId);
		keptTouches.delete(event.pointerId);
		touch("up", fingerOf(event));
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
		if (onCanvas(event.target)) props.onSelect(undefined);
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
			el().setPointerCapture(event.pointerId);
		} catch {
			// Capture is per-pointer and can be refused; the listeners above still carry
			// the gesture for as long as the finger stays over the stage.
		}
	};

	/**
	 * The whole hand, gone: the tab went to the background, or the OS took the gesture.
	 *
	 * Neither of those ends a touch in a way any document is told about — the events
	 * simply stop — so every finger in the pool is released. Without this, backgrounding the
	 * tab mid-pan is enough to leave the canvas reading every later touch as a pinch.
	 */
	const lostTouches = () => {
		if (carried.size === 0 && touches.count() === 0) return;
		releaseCarried();
		for (const id of touches.ids()) touches.up(id);
		claimed.clear();
		setPanning(false);
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
		window.removeEventListener("pointermove", onTouchMove);
		window.removeEventListener("pointerup", onTouchEnd);
		window.removeEventListener("pointercancel", onTouchEnd);
	});

	/** What an item's slot asks of the stage's fingers: a finger its bar or edge took carries the item, and the camera does not pan with it. */
	const gestures: StageBoardProps["gestures"] = {
		claimTouch: (id) => {
			claimed.add(id);
			keptTouches.add(id);
		},
		pinching: () => touches.count() > 1,
	};

	/**
	 * The camera dragged from a press (`editor/core/dispatch.ts`, `pan`): with the middle button, with
	 * Space held, or on bare canvas, which lets the selected board go (`deselect`).
	 */
	const panFrom = (event: PointerEvent, how: { deselect: boolean; middle: boolean }) => {
		const { middle } = how;
		event.preventDefault();
		const element = el();
		if (how.deselect) props.onSelect(undefined);
		element.setPointerCapture(event.pointerId);
		setPanning(true);

		let last = { x: event.clientX, y: event.clientY };
		const move = (moveEvent: PointerEvent) => {
			pushCamera(pan(ctl.now(), moveEvent.clientX - last.x, moveEvent.clientY - last.y));
			last = { x: moveEvent.clientX, y: moveEvent.clientY };
			deps.editor().panned();
		};
		// Ended on any sign the button is up, not only its release (`held.ts`).
		const stop = untilReleased({ docs: [document], held: middle ? 4 : 1, capture: element, end: () => finish() });
		const finish = () => {
			stop();
			element.removeEventListener("pointermove", move);
			setPanning(false);
		};
		element.addEventListener("pointermove", move);
	};

	return { grabbing, pressHeld, onWheel, touches, claimed, keptTouches, beginTouch, panFrom, gestures };
}
