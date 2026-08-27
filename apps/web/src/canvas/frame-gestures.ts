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
 */

export interface FrameGestureHost {
	/** A wheel or pinch, with the cursor position already in stage coordinates. */
	wheel(gesture: { x: number; y: number; deltaX: number; deltaY: number; zooming: boolean }): void;
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
			const box = scrollableUnder(event);
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

	/** The nearest box under the cursor that can still take this scroll, if any. */
	function scrollableUnder(event: WheelEvent): Element | undefined {
		let node = event.target as Element | null;
		while (node && node !== doc.body) {
			if (canScroll(node, event.deltaX, event.deltaY)) return node;
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
		win.removeEventListener("blur", onBlur);
		if (spaceHeld) host.space(false);
	};
}
