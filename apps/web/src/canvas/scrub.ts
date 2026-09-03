/**
 * Drag a label, change a number.
 *
 * The inspector's X / Y / W / H fields are the one thing the redesign adds that the app
 * could not do at all: a component's position is an inline `left`/`top`/`width` in an HTML
 * file, the drag handles have always rewritten those bytes, and there was no way to *read*
 * the number, let alone type one. A field you can type into is half of that; the other half
 * is that a canvas is a place you nudge things, so the label is a handle — 1px of drag is
 * one unit, `⇧` is ten, `⌥` is a tenth (`boards/the-inspector-a-real-properties-panel`).
 *
 * **One patch on release, not one per pixel, and this is the whole reason the file is
 * shaped the way it is.** Every patch is a revision and the revision list is the undo
 * history (DESIGN §6.7) — `Inspector.tsx` already makes that argument for its text fields,
 * which is why they commit on Enter rather than per keystroke. A scrub is the same argument
 * an order of magnitude worse: a 200px drag at 60fps is a few hundred writes, each of them
 * an entry that buries a day's work, and each of them a patch composed against a revision
 * the one before it has already replaced (`patches.ts`). So the drag mutates the live
 * document and nothing else, and exactly one `onCommit` happens when the pointer comes up.
 * `coalesce` would have absorbed the burst into one *network* message, but not into one
 * revision, and the revision is what the user has to live with.
 *
 * The alternative considered and rejected: commit on a trailing debounce, so a slow scrub
 * writes as it goes. It gets the common case right and the interesting one wrong — pause
 * mid-drag to look at the board and you have already written, so Escape has nothing left to
 * cancel. A drag either happened or it did not.
 *
 * ### The arithmetic is separate from the pointer on purpose
 *
 * `beginScrub` / `moveScrub` / `cancelScrub` / `commitScrub` are four pure functions over a
 * plain object, and `scrubbable` is a thin wrapper that feeds them events. That is what
 * makes the modifier multipliers, the rounding, the clamp, the Escape path and "a drag of
 * zero pixels commits nothing" testable in `scrub.test.ts` with no DOM at all — the parts
 * that are easy to get subtly wrong are the parts that need no browser to check.
 */

/** The modifier keys that change what a pixel of drag is worth. */
export interface ScrubMods {
	shift?: boolean;
	alt?: boolean;
}

/** What the number is allowed to be, and how finely it moves. */
export interface ScrubRange {
	/** The field's own increment, and the unit one pixel of drag is worth. Defaults to 1. */
	step?: number;
	min?: number;
	max?: number;
}

/** A drag in progress: where it started, and where it is now. */
export interface ScrubDrag {
	/** The value at `pointerdown`. What Escape goes back to, and what "nothing moved" means. */
	readonly from: number;
	/** The `clientX` at `pointerdown`. Horizontal only: a number line has one axis. */
	readonly at: number;
	/** The live value — what the board is showing and the field is displaying. */
	value: number;
	/** Set by Escape, and the reason `commitScrub` writes nothing afterwards. */
	cancelled: boolean;
}

/**
 * The value a drag of `dx` pixels lands on.
 *
 * Two roundings, and they do different jobs. `Math.round(dx)` is *whole pixels of drag*,
 * so a fractional pointer coordinate on a HiDPI screen does not make the number jitter.
 * Rounding to a multiple of `step` is what keeps the field's own precision: these are CSS
 * pixels in an HTML file and the server writes them as integers (`boards/patch.ts` rounds),
 * so a field whose step is 1 must never commit `560.3` and then read back `560`.
 *
 * That second rounding is also what gives `⌥` its meaning on an integer field. At a tenth
 * of a unit per pixel the number does not move until the pointer has travelled ten pixels —
 * which is precisely the fine control the modifier is for, rather than the fractional
 * pixels it would otherwise produce.
 *
 * Deliberately *not* snapping to an absolute grid. `Math.round(value / 10) * 10` under `⇧`
 * would be tidier to look at and it breaks the one invariant that matters: a drag that goes
 * nowhere would still move 824 to 820, so releasing where you pressed would write a
 * revision.
 */
export function scrubValue(from: number, dx: number, mods: ScrubMods = {}, range: ScrubRange = {}): number {
	const step = range.step !== undefined && range.step > 0 ? range.step : 1;
	const unit = mods.shift ? step * 10 : mods.alt ? step / 10 : step;
	const stepped = Math.round((from + Math.round(dx) * unit) / step) * step;
	// `raw / step` with a step of 0.1 is a number like 5.999999999999999, and its product
	// carries the dust into the file. Six places is far more than a CSS pixel needs.
	const value = Number(stepped.toFixed(6));
	return Math.min(Math.max(value, range.min ?? -Infinity), range.max ?? Infinity);
}

/** The pointer went down on a label. */
export function beginScrub(from: number, at: number): ScrubDrag {
	return { from, at, value: from, cancelled: false };
}

/**
 * The pointer moved. Returns whether the live value actually changed.
 *
 * The caller only previews on `true`, which matters more than it looks: under `⌥` most
 * moves land on the same number, and re-writing the same `style.left` on every one of them
 * invalidates the board's layout for nothing.
 */
export function moveScrub(drag: ScrubDrag, clientX: number, mods: ScrubMods, range?: ScrubRange): boolean {
	if (drag.cancelled) return false;
	const next = scrubValue(drag.from, clientX - drag.at, mods, range);
	if (next === drag.value) return false;
	drag.value = next;
	return true;
}

/** Escape, or the pointer being taken away. Returns the value to put back on the board. */
export function cancelScrub(drag: ScrubDrag): number {
	drag.cancelled = true;
	drag.value = drag.from;
	return drag.from;
}

/**
 * What the release should write — or nothing at all.
 *
 * `undefined` for a cancelled drag and for one that came back to where it started. The
 * second case is not a nicety: a click on the label is a drag of zero pixels, and a click
 * that writes a revision identical to the file is the same mistake the box buttons are
 * guarded against ("the one it already is does nothing at all").
 */
export function commitScrub(drag: ScrubDrag): number | undefined {
	if (drag.cancelled || drag.value === drag.from) return undefined;
	return drag.value;
}

export interface ScrubOptions extends ScrubRange {
	/** The value to start from, asked at `pointerdown` so it is never stale. */
	value: () => number;
	/** Every change during the drag: the live document, and nothing that writes. */
	onPreview: (value: number) => void;
	/** Once, on release. Not called for a cancelled drag or a drag that moved nothing. */
	onCommit: (value: number) => void;
}

/**
 * Make an element the handle for a number. Returns the teardown for `onCleanup`.
 *
 * `setPointerCapture` rather than window listeners, and it is the difference between a
 * scrubber and a nearly-working one: the capture retargets every subsequent `pointermove`
 * and the `pointerup` to this element, so a drag that runs off the panel, over a board, or
 * out of the window still arrives here and still ends. Window listeners get most of that
 * and lose the pointer to whatever iframe it crosses — and this app is a canvas full of
 * iframes.
 */
export function scrubbable(el: HTMLElement, options: ScrubOptions): () => void {
	let drag: ScrubDrag | undefined;
	let pointer = -1;

	const range = (): ScrubRange => ({ step: options.step, min: options.min, max: options.max });

	/*
	 * The cursor is set on the root element, not on the handle.
	 *
	 * `chrome.css` already gives the label `cursor: ew-resize` at rest, which is the
	 * affordance; this is the *drag*, and during a drag the pointer is usually nowhere near
	 * the label it is pulling. Without it the cursor becomes whatever it is over — a text
	 * caret on a board's words, a grab hand on the canvas — which reads as the gesture
	 * having been dropped.
	 */
	const root = el.ownerDocument.documentElement;

	const finish = () => {
		drag = undefined;
		root.style.removeProperty("cursor");
		delete el.dataset.scrubbing;
		if (el.hasPointerCapture?.(pointer)) el.releasePointerCapture(pointer);
		pointer = -1;
		el.ownerDocument.removeEventListener("keydown", onKey, true);
	};

	const abort = () => {
		if (!drag) return;
		options.onPreview(cancelScrub(drag));
		finish();
	};

	/*
	 * Escape is listened for in the *capture* phase and its propagation stopped, which is
	 * the only way this can be a cancel at all. Escape already means "let the selection go"
	 * to `Editor.ts` and "close the inspector" to `App` — so a bubbling listener would put
	 * the number back and then dismiss the panel it belongs to, and the undo would look
	 * like a crash.
	 */
	function onKey(event: KeyboardEvent) {
		if (!drag || event.key !== "Escape") return;
		event.preventDefault();
		event.stopPropagation();
		abort();
	}

	const onDown = (event: PointerEvent) => {
		// The primary button only. A right-click is a context menu and a middle-click is a
		// paste on some platforms; neither is a gesture anybody aimed at a label.
		if (drag || event.button !== 0) return;
		// Stops the label being selected as text and stops focus leaving whichever field
		// the user was typing in. `user-select: none` is on the class as well, for the
		// double-click that never reaches a handler.
		event.preventDefault();
		drag = beginScrub(options.value(), event.clientX);
		pointer = event.pointerId;
		el.setPointerCapture(pointer);
		el.dataset.scrubbing = "true";
		root.style.setProperty("cursor", "ew-resize");
		el.ownerDocument.addEventListener("keydown", onKey, true);
	};

	const onMove = (event: PointerEvent) => {
		if (!drag || event.pointerId !== pointer) return;
		if (moveScrub(drag, event.clientX, { shift: event.shiftKey, alt: event.altKey }, range())) {
			options.onPreview(drag.value);
		}
	};

	const onUp = (event: PointerEvent) => {
		if (!drag || event.pointerId !== pointer) return;
		const ended = drag;
		finish();
		const value = commitScrub(ended);
		if (value !== undefined) options.onCommit(value);
	};

	el.addEventListener("pointerdown", onDown);
	el.addEventListener("pointermove", onMove);
	el.addEventListener("pointerup", onUp);
	el.addEventListener("pointercancel", abort);
	// The element leaving the document mid-drag — the selection changing under it — takes
	// the capture with it and no `pointerup` ever arrives. Without this the root keeps a
	// resize cursor for the rest of the session.
	el.addEventListener("lostpointercapture", abort);

	/*
	 * `touch-action: none` from script rather than from the stylesheet, because it is
	 * behaviour and not appearance: the body sets `touch-action: manipulation` for the whole
	 * chrome, and without this a finger dragging the label is a scroll gesture the browser
	 * claims before the first `pointermove` is delivered.
	 */
	const had = el.style.touchAction;
	el.style.touchAction = "none";

	return () => {
		abort();
		el.style.touchAction = had;
		el.removeEventListener("pointerdown", onDown);
		el.removeEventListener("pointermove", onMove);
		el.removeEventListener("pointerup", onUp);
		el.removeEventListener("pointercancel", abort);
		el.removeEventListener("lostpointercapture", abort);
	};
}
