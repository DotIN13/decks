import { noteCameraMove } from "./pan-signal.ts";
import type { Finger, TouchStep } from "./touch.ts";

/**
 * Canvas gestures that begin inside a board.
 *
 * A board frame is a separate document, so events that happen over it never reach
 * the stage — a wheel event does not bubble out of an iframe, and no amount of
 * listening in the parent will see it. With the frame live (above `INTERACT_ZOOM`)
 * that meant two-finger panning and pinch-zooming stopped working exactly where the
 * user is most likely to be looking: over the work.
 *
 * Same origin (DESIGN §4) makes the fix small: listen inside the frame and hand the
 * gesture to the stage. The frame owns the gesture's mechanics — it is where the
 * pointer is — and the stage owns the camera.
 *
 * Coordinates need care. `clientX/clientY` inside the frame are in the *board's*
 * pixels, because the stage's zoom is a CSS transform on an ancestor and the frame's
 * own coordinate system knows nothing about it. Wheel *deltas*, on the other hand,
 * are physical scroll amounts and are not scaled by that transform. So positions are
 * converted and deltas are passed through — and there is a test that pans by the same
 * delta over bare stage and over a board and insists the camera moves equally.
 *
 * **Touch is the same problem again, and it is worse before it is fixed.** A finger
 * inside a board produced no wheel event and no gesture at all: at a readable zoom the
 * frame takes pointer events, so a one-finger drag over a board — which is most of the
 * screen when you are reading one — moved nothing, and the canvas was simply frozen.
 * So this file also owns the frame's half of the touch gestures, by the same division
 * of labour: the frame knows where the fingers are, the stage owns the camera
 * (`touch.ts` reduces a set of fingers to a pan or a pinch step).
 *
 * Two rules decide what one finger means, both of them the same rules the wheel already
 * followed. A scroll a box inside the board can take is given to it, decided once at
 * the start of the gesture and then held — flipping from scrolling an embed to panning
 * the canvas halfway through a drag is not a thing a hand can aim. And anything else
 * pans, unless the editor claimed the gesture first, which it says by calling
 * `preventDefault` on the `pointerdown` (it listens in this document too, and
 * `BoardFrame` attaches it before this file for exactly that reason).
 */

export interface FrameGestureHost {
	/** A wheel or pinch, with the cursor position already in stage coordinates. */
	wheel(gesture: { x: number; y: number; deltaX: number; deltaY: number; zooming: boolean }): void;
	/**
	 * One finger of a canvas gesture, in stage coordinates.
	 *
	 * Reported rather than acted on, because the stage pools the fingers from every
	 * document it can see (`Stage`): a pinch with one finger on a board and the other on
	 * bare canvas is two event streams and one gesture, and each stream keeping its own
	 * idea of the gesture turns it into two pans. What comes back is what the stage made
	 * of it, so this side can tell a pinch from a pan without tracking anything.
	 */
	touch(phase: "down" | "move" | "up", finger: Finger): TouchStep;
	/**
	 * This finger belongs to something inside the board, not to the camera.
	 *
	 * A scrollable embed, here, and a board being dragged by its title bar in
	 * `BoardFrame`. The stage keeps tracking a claimed finger — it is still half of a
	 * pinch if a second one lands — and simply does not pan with it.
	 */
	claimTouch(id: number): void;
	/** Whether two or more fingers are down anywhere, which always means the canvas. */
	pinching(): boolean;
	/** A drag that means "move the canvas", reported as it happens, in screen pixels. */
	pan(dx: number, dy: number): void;
	/** Space is a modifier the stage also listens for; it has to hear it from here too. */
	space(held: boolean): void;
	/**
	 * Whether space is held anywhere.
	 *
	 * Asked rather than tracked: each document only sees the keys pressed while it has
	 * focus, so a space pressed over the canvas and a drag started over a board are
	 * two documents with two opinions. The stage is the one that counts.
	 */
	spaceHeld(): boolean;
	/** Whether the stage is currently letting the frame have pointer events at all. */
	interactive(): boolean;
	/**
	 * Where the pointer is, in the parent document's coordinates.
	 *
	 * The floating panels appear when the cursor reaches a screen edge, and they can
	 * only know that if somebody tells them while the cursor is over a board.
	 */
	pointer(x: number, y: number): void;
	/**
	 * A camera shortcut pressed while focus was inside a board.
	 *
	 * Returns whether it meant something, so the frame knows whether to swallow it.
	 */
	key(name: string): boolean;
}

export function attachFrameGestures(frame: HTMLIFrameElement, host: FrameGestureHost): () => void {
	const document = frame.contentDocument;
	const view = frame.contentWindow;
	if (!document || !view) return () => {};
	const doc = document;
	const win = view;

	/** Board pixels -> stage pixels, and where the frame sits on screen. */
	const geometry = () => {
		const rect = frame.getBoundingClientRect();
		const scale = frame.clientWidth > 0 ? rect.width / frame.clientWidth : 1;
		const stage = frame.ownerDocument.querySelector(".stage")?.getBoundingClientRect();
		return { rect, scale, stageLeft: stage?.left ?? 0, stageTop: stage?.top ?? 0 };
	};

	const toStage = (clientX: number, clientY: number) => {
		const { rect, scale, stageLeft, stageTop } = geometry();
		return { x: rect.left + clientX * scale - stageLeft, y: rect.top + clientY * scale - stageTop };
	};

	const onWheel = (event: WheelEvent) => {
		// A pinch is always the canvas zooming; nothing inside a board zooms.
		const zooming = event.ctrlKey || event.metaKey;
		/*
		 * A board does not scroll — the canvas does — but something *inside* a board
		 * might. An embedded paper or a long markdown file has its own scrollbar, and
		 * turning that into a canvas pan would make the embed unreadable. So a scroll a
		 * nested box can still take is given to it, and the canvas takes the rest —
		 * including the moment the box reaches its end.
		 *
		 * Scrolled here rather than by letting the browser do it. Inside an iframe the
		 * stage has scaled, leaving the default action alone does not reliably scroll
		 * anything (it works on the same board opened on its own, and not at 64%), and
		 * a feature that depends on that is a feature that breaks per browser. Doing it
		 * by hand is also what makes the content follow the fingers: the delta is
		 * screen pixels, and the box is being drawn at `scale`.
		 */
		if (!zooming) {
			const box = scrollableUnder(event.target, event.deltaX, event.deltaY);
			if (box) {
				event.preventDefault();
				const { scale } = geometry();
				box.scrollLeft += event.deltaX / scale;
				box.scrollTop += event.deltaY / scale;
				return;
			}
		}

		event.preventDefault();
		const at = toStage(event.clientX, event.clientY);
		host.wheel({ x: at.x, y: at.y, deltaX: event.deltaX, deltaY: event.deltaY, zooming });
	};

	/** The nearest box under the pointer that can still take this scroll, if any. */
	function scrollableUnder(target: EventTarget | null, deltaX: number, deltaY: number): Element | undefined {
		let node = target as Element | null;
		while (node && node !== doc.body) {
			if (canScroll(node, deltaX, deltaY)) return node;
			node = node.parentElement;
		}
		return undefined;
	}

	function canScroll(element: Element, deltaX: number, deltaY: number): boolean {
		const style = win.getComputedStyle(element);
		const vertical = /auto|scroll/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1;
		const horizontal = /auto|scroll/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 1;

		// At the end of the box the canvas takes over, so a flick keeps panning rather
		// than stopping dead at the bottom of an embed.
		if (vertical && Math.abs(deltaY) >= Math.abs(deltaX)) {
			const room = deltaY > 0 ? element.scrollHeight - element.clientHeight - element.scrollTop : element.scrollTop;
			if (room > 1) return true;
		}
		if (horizontal && Math.abs(deltaX) > Math.abs(deltaY)) {
			const room = deltaX > 0 ? element.scrollWidth - element.clientWidth - element.scrollLeft : element.scrollLeft;
			if (room > 1) return true;
		}
		return false;
	}

	let spaceHeld = false;
	const onKeyDown = (event: KeyboardEvent) => {
		// Someone typing into a component owns every key, including the space bar.
		if ((event.target as HTMLElement | null)?.isContentEditable) return;

		if (event.code === "Space") {
			event.preventDefault();
			if (spaceHeld) return;
			spaceHeld = true;
			host.space(true);
			return;
		}

		/*
		 * The camera shortcuts, handed back to the stage. Deliberately only these: the
		 * editor listens in this same document for ⌘Z, Delete, Escape and the arrows,
		 * and forwarding everything would take those away from it.
		 */
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		if (host.key(event.key)) event.preventDefault();
	};
	const onKeyUp = (event: KeyboardEvent) => {
		if (event.code !== "Space" || !spaceHeld) return;
		spaceHeld = false;
		host.space(false);
	};

	/**
	 * Space-drag and middle-drag, taken in the capture phase.
	 *
	 * Capture matters: the editor also listens for `pointerdown` in this document, and
	 * a pan that starts over a component must not also start dragging that component.
	 */
	const onPointerDown = (event: PointerEvent) => {
		const wantsPan = event.button === 1 || ((spaceHeld || host.spaceHeld()) && event.button === 0);
		if (!wantsPan) return;
		event.preventDefault();
		event.stopPropagation();

		const { scale } = geometry();
		let last = { x: event.clientX, y: event.clientY };
		const target = event.target as Element;
		try {
			target.setPointerCapture(event.pointerId);
		} catch {
			// Capture is a nicety; the document listeners below carry the drag anyway.
		}

		const move = (moveEvent: PointerEvent) => {
			// In-frame movement is in board pixels; the camera pans in screen pixels.
			host.pan((moveEvent.clientX - last.x) * scale, (moveEvent.clientY - last.y) * scale);
			last = { x: moveEvent.clientX, y: moveEvent.clientY };
		};
		const finish = () => {
			doc.removeEventListener("pointermove", move, true);
			doc.removeEventListener("pointerup", finish, true);
			doc.removeEventListener("pointercancel", finish, true);
		};
		doc.addEventListener("pointermove", move, true);
		doc.addEventListener("pointerup", finish, true);
		doc.addEventListener("pointercancel", finish, true);
	};

	/**
	 * Fingers inside the board, and what they mean.
	 *
	 * `touch-action: none` is what makes any of it reachable: without it the browser
	 * claims a one-finger drag for scrolling the board document and stops delivering the
	 * pointer events mid-gesture. **On every element, not only the root** — that was tried
	 * first, and the browser still claimed a finger that landed inside an embed's own
	 * scroller, scrolled it natively and sent a `pointercancel` three events in, leaving
	 * the gesture half native and half ours with the canvas taking the rest. A universal
	 * selector is blunt and it is exactly the intent: a board on the stage does not scroll
	 * itself, and the scrolling that looks native is done by hand for the reason the wheel
	 * path documents (inside a scaled iframe the browser does not reliably scroll
	 * anything, and by hand is also what makes the content follow the fingers).
	 *
	 * The style is marked `data-decks-ui`, like the editor's handles and the drop
	 * highlight — an app affordance in the board's DOM, never in its file — so a board
	 * opened on its own scrolls the way any page does.
	 */
	const touchStyle = doc.createElement("style");
	touchStyle.dataset.decksUi = "true";
	touchStyle.textContent = `* { touch-action: none; }`;
	doc.head.appendChild(touchStyle);

	/**
	 * What this gesture turned out to be, decided on its first real movement.
	 *
	 * `theirs` means the editor took it — dragging a component that is already selected,
	 * or drawing with a tool — which it says by calling `preventDefault` on the
	 * `pointerdown` it acted on.
	 */
	let mode: "undecided" | "camera" | "scroll" | "theirs" = "undecided";
	let scrolling: Element | undefined;
	/**
	 * In-frame positions, kept only for the scroll delta, which is in board pixels — and
	 * the element each finger landed on.
	 *
	 * The landing element, because the moves cannot be asked: this file captures the
	 * pointer to the document element so a finger that slides off the board keeps driving
	 * the gesture, and a captured pointer's events all target the capturing element. So
	 * `event.target` on a move is `<html>`, and asking *that* whether it can scroll found
	 * nothing however carefully the finger was placed inside an embed.
	 */
	const inFrame = new Map<number, { x: number; y: number; on: EventTarget | null }>();

	/**
	 * A finger, in stage coordinates rather than the frame's.
	 *
	 * This conversion is the whole correctness argument for the touch path, and it is not
	 * the same one the wheel makes. In-frame pixels are board pixels — but they are board
	 * pixels of a board the gesture is *moving*, so a finger that has not moved reports a
	 * different position after every pan, and a pan measured in them cancels half of
	 * itself: dragging 60 screen pixels moved the camera 30. Screen space is the frame of
	 * reference in which a still finger is still, so the frame converts on the way out and
	 * the stage takes the positions as given (`Stage`, and the offset must not be
	 * subtracted twice — that is a horizontal pinch that walks the canvas 90px downwards).
	 *
	 * The geometry is read per event, which is fine because the browser reports the
	 * coordinates against the layout each event was dispatched into, and the camera is
	 * moved synchronously in the handler: the pair agrees. Measured, not assumed — the
	 * mobile check asserts a pinch over a board holds its midpoint to within 3px, and it
	 * holds to within a tenth of one.
	 */
	const fingerAt = (event: PointerEvent) => {
		const { rect, scale, stageLeft, stageTop } = geometry();
		return {
			id: event.pointerId,
			x: rect.left + event.clientX * scale - stageLeft,
			y: rect.top + event.clientY * scale - stageTop,
		};
	};

	const onTouchDown = (event: PointerEvent) => {
		if (event.pointerType !== "touch") return;
		if (inFrame.size === 0) {
			// The editor takes the gesture by preventing the default on this same event
			// (it drags a component already selected, or draws with a tool). It listens in
			// this document too and `BoardFrame` attaches it first, so by now it has said.
			mode = event.defaultPrevented ? "theirs" : "undecided";
			scrolling = undefined;
			doc.addEventListener("pointermove", onTouchMove, true);
			doc.addEventListener("pointerup", onTouchUp, true);
			doc.addEventListener("pointercancel", onTouchUp, true);
		}
		inFrame.set(event.pointerId, { x: event.clientX, y: event.clientY, on: event.target });
		host.touch("down", fingerAt(event));
		// A finger the editor has taken is not the camera's — but it is still half of a
		// pinch if a second one lands, so it is claimed rather than withheld.
		if (mode === "theirs") host.claimTouch(event.pointerId);
		try {
			// Captured so a finger that slides off the board keeps driving the gesture:
			// without it the events retarget to the parent document and the pan stops.
			doc.documentElement.setPointerCapture(event.pointerId);
		} catch {
			/* capture is a nicety; the document listeners carry the gesture regardless */
		}
	};

	const onTouchMove = (event: PointerEvent) => {
		if (event.pointerType !== "touch") return;
		const was = inFrame.get(event.pointerId);
		if (!was) return;
		const board = { dx: event.clientX - was.x, dy: event.clientY - was.y };
		was.x = event.clientX;
		was.y = event.clientY;

		/*
		 * The scroll decision, made before the stage is told anything.
		 *
		 * A scroll a box inside the board can take is given to it — the rule the wheel
		 * path already follows, for the reason it documents there. Decided once, on the
		 * first real movement of a single finger, and then held: flipping from scrolling
		 * an embed to panning the canvas halfway through a drag is not something a hand
		 * can aim. A wheel's deltas point the way the *content* moves, which is opposite
		 * to the way a finger travels, so the question asked of the box is the same one.
		 */
		if (mode === "undecided" && !host.pinching() && (Math.abs(board.dx) >= 2 || Math.abs(board.dy) >= 2)) {
			const box = scrollableUnder(was.on, -board.dx, -board.dy);
			mode = box ? "scroll" : "camera";
			scrolling = box;
			if (box) host.claimTouch(event.pointerId);
		}

		const finger = fingerAt(event);
		const step = host.touch("move", finger);
		// Said out loud for the editor, which is holding a pending tap for this finger and
		// cannot tell a pan from a tap by how far it moved (`pan-signal.ts`).
		if (step.kind !== "idle" && mode !== "scroll") noteCameraMove(doc);
		if (step.kind === "pinch") {
			// Two fingers are always the canvas, whatever one finger was doing. The stage
			// has already dropped the claim; this side stops scrolling with it.
			mode = "camera";
			scrolling = undefined;
			return;
		}
		if (mode !== "scroll" || !scrolling) return;
		// Board pixels, straight out of the frame's own coordinates: the box is laid out
		// in them, which is what makes the content follow the finger at any zoom.
		scrolling.scrollLeft -= board.dx;
		scrolling.scrollTop -= board.dy;
	};

	const onTouchUp = (event: PointerEvent) => {
		if (event.pointerType !== "touch") return;
		if (!inFrame.delete(event.pointerId)) return;
		host.touch("up", fingerAt(event));
		if (inFrame.size > 0) return;
		mode = "undecided";
		scrolling = undefined;
		doc.removeEventListener("pointermove", onTouchMove, true);
		doc.removeEventListener("pointerup", onTouchUp, true);
		doc.removeEventListener("pointercancel", onTouchUp, true);
	};

	// Reported, not acted on: this is only so the edge panels know where the cursor is.
	const onPointerMoveReport = (event: PointerEvent) => {
		const at = toStage(event.clientX, event.clientY);
		const stage = frame.ownerDocument.querySelector(".stage")?.getBoundingClientRect();
		host.pointer(at.x + (stage?.left ?? 0), at.y + (stage?.top ?? 0));
	};

	doc.addEventListener("pointermove", onPointerMoveReport, { passive: true, capture: true });
	doc.addEventListener("wheel", onWheel, { passive: false, capture: true });
	doc.addEventListener("keydown", onKeyDown, true);
	doc.addEventListener("keyup", onKeyUp, true);
	doc.addEventListener("pointerdown", onPointerDown, true);
	/*
	 * Bubble, not capture, and that is the whole handshake with the editor: it also
	 * listens for `pointerdown` in this document, and a finger that lands on a component
	 * it wants to drag must not also pan the canvas. Capture would run before it had a
	 * chance to say so.
	 */
	doc.addEventListener("pointerdown", onTouchDown);

	// A frame that loses the pointer mid-gesture must not leave the stage think space
	// is still held — the cursor would stay a grabbing hand over the whole canvas.
	const onBlur = () => {
		if (!spaceHeld) return;
		spaceHeld = false;
		host.space(false);
	};
	win.addEventListener("blur", onBlur);

	return () => {
		doc.removeEventListener("pointermove", onPointerMoveReport, true);
		doc.removeEventListener("wheel", onWheel, true);
		doc.removeEventListener("keydown", onKeyDown, true);
		doc.removeEventListener("keyup", onKeyUp, true);
		doc.removeEventListener("pointerdown", onPointerDown, true);
		doc.removeEventListener("pointerdown", onTouchDown);
		doc.removeEventListener("pointermove", onTouchMove, true);
		doc.removeEventListener("pointerup", onTouchUp, true);
		doc.removeEventListener("pointercancel", onTouchUp, true);
		touchStyle.remove();
		win.removeEventListener("blur", onBlur);
		if (spaceHeld) host.space(false);
	};
}
