import {
	type Box,
	type Pin,
	type Point,
	type Sample,
	type Saved,
	type Size,
	clamp,
	fling,
	fromSaved,
	glideMs,
	loadFloats,
	loadStowed,
	saveFloat,
	saveStowed,
	settle as restingPlace,
	snapHome,
	stowedAt,
	stowsRight,
	toFraction,
	velocityFrom,
	verticalShare,
} from "./float-math.ts";

/**
 * The DOM half of a draggable float. All the numbers come from `float-math.ts`; this file
 * only listens to the pointer and tells the caller where the element now is.
 *
 * Framework-free on purpose. It is called from a Solid component's `onMount` and disposed
 * in `onCleanup`, but it knows nothing about signals, so the same code could sit behind
 * any renderer, and the math beneath it is tested without a DOM.
 *
 * The element's position is not read back from the DOM. `apply` is the only writer, and the
 * caller decides what it means (an inline `left`/`top`, a transform, whatever the CSS
 * wants). When a float is at home, `apply(undefined, true)` is the instruction to remove
 * any inline position and let the stylesheet place it, so a layout change moves the
 * float's home without anyone storing new numbers.
 */

export interface FloatOptions {
	/** Storage key within `decks.floats`. */
	key: string;
	/** Where a drag may start. */
	handle: HTMLElement;
	/** A selector; a pointerdown inside a match is not a drag (inputs, buttons). */
	ignore?: string;
	/** Where it lives by default, in bounds coordinates. */
	home: () => Point;
	/** The box it may move in (the surface), in the same frame as `home`. */
	bounds: () => Box;
	size: () => Size;
	/** While true nothing happens, and `restore` puts it home (narrow screens, say). */
	disabled?: () => boolean;
	/**
	 * `undefined` means at home: remove the inline position so the CSS places it. `stowed`
	 * is true while the float is put away behind the right edge, where `p` leaves only its
	 * tab showing; the caller draws the tab and makes the rest unreachable.
	 */
	apply: (p: Point | undefined, home: boolean, stowed: boolean) => void;
	/**
	 * Let a hard throw at the right edge put the float away (`stowsRight`), with `tab`
	 * pixels of it left showing. `unstow` on the returned handle brings it back to where it
	 * was. Without this a throw at the edge parks against it, as it always has.
	 */
	stow?: { tab: number };
	/**
	 * Where the element's top-left is *now*, when the DOM may know better than the last
	 * `apply`: a float pinned by its bottom edge moves its top whenever its height changes
	 * (the composer loses its status row when the conversation opens), and a drag that
	 * started from the remembered top would jump by the difference.
	 */
	read?: () => Point;
	onChange?: (saved: Saved) => void;
	storage?: Storage;
	/**
	 * An element whose resizes should re-place the float, usually the surface. Without it
	 * the float still follows the window's `resize`; the caller may also call `restore`.
	 */
	observe?: Element;
	/** Which edge the vertical share is measured from; see `Pin`. `"top"` unless said. */
	pin?: Pin;
}

/** Fewer pixels than this and a press was a click, not a drag; nothing is saved. */
const DRAG_THRESHOLD = 3;

/** How many recent pointer positions to keep for the velocity at release. */
const SAMPLES = 8;

export function makeFloat(
	el: HTMLElement,
	options: FloatOptions,
): { restore: () => void; sendHome: () => void; unstow: () => void; stowed: () => boolean; dispose: () => void } {
	const { key, handle, ignore, home, bounds, size, apply, onChange, storage } = options;
	const pin: Pin = options.pin ?? "top";
	const disabled = (): boolean => options.disabled?.() === true;

	/** Where the float is now, or `undefined` when the CSS places it at home. */
	let current: Point | undefined;
	let drag: { pointerId: number; startPointer: Point; startPos: Point; moved: boolean; samples: Sample[] } | undefined;

	/** Put away behind the right edge. Where it comes back to is whatever `key` has saved. */
	let stowed = false;

	const place = (p: Point | undefined): void => {
		current = p;
		apply(p, p === undefined, stowed && p !== undefined);
	};

	/**
	 * A drop does not land; it glides. `[data-snapping]` turns the CSS transition on, with
	 * `--snap-ms` saying how long (longer for a longer way), the element is placed at where
	 * it is going, and when the transition ends (or a timer says it must have) the attribute
	 * comes off. A glide *home* ends one step later: the element is handed back to the
	 * stylesheet only once it is already standing where the stylesheet would put it, so
	 * nothing jumps.
	 */
	let settling: { timer: ReturnType<typeof setTimeout>; finish: (event?: Event) => void } | undefined;
	const cancelSettle = (): void => {
		if (!settling) return;
		clearTimeout(settling.timer);
		el.removeEventListener("transitionend", settling.finish);
		settling = undefined;
		delete el.dataset.snapping;
	};
	const settle = (p: Point, thenHome: boolean): void => {
		cancelSettle();
		const ms = glideMs(current ?? home(), p);
		el.style.setProperty("--snap-ms", `${ms}ms`);
		el.dataset.snapping = "true";
		place(p);
		const finish = (event?: Event): void => {
			// A child's own transition (a border colour, say) ends too, and is not this one.
			if (event && event.target !== el) return;
			cancelSettle();
			if (!thenHome) return;
			// The stylesheet's own `left` transition (the dock slides when the sidebar folds)
			// would animate the handoff too, and half the width of a transform is a visible
			// jump. Off for a frame, then back.
			el.dataset.landing = "true";
			place(undefined);
			try {
				requestAnimationFrame(() => requestAnimationFrame(() => delete el.dataset.landing));
			} catch {
				delete el.dataset.landing;
			}
		};
		settling = { timer: setTimeout(finish, ms + 80), finish };
		el.addEventListener("transitionend", finish);
	};

	const remember = (saved: Saved): void => {
		saveFloat(key, saved, storage);
		onChange?.(saved);
	};

	const onIgnored = (target: EventTarget | null): boolean =>
		ignore !== undefined && target instanceof Element && target.closest(ignore) !== null;

	const restore = (): void => {
		if (drag) return;
		cancelSettle();
		if (disabled()) {
			// Nothing is thrown where nothing is dragged; it is not forgotten, only not drawn.
			stowed = false;
			place(undefined);
			return;
		}
		const away = options.stow ? loadStowed(storage)[key] : undefined;
		if (options.stow && away !== undefined) {
			stowed = true;
			const y = fromSaved({ fx: 1, fy: away }, size(), bounds(), home(), 6, pin).y;
			const p = stowedAt(y, size(), bounds(), options.stow.tab);
			if (current !== undefined && (current.x !== p.x || current.y !== p.y)) settle(p, false);
			else place(p);
			return;
		}
		stowed = false;
		const saved = loadFloats(storage)[key];
		if (saved === undefined || saved === "home") {
			place(undefined);
			return;
		}
		const p = clamp(fromSaved(saved, size(), bounds(), home(), 6, pin), size(), bounds());
		const snapped = snapHome(p, home());
		if (snapped.home) {
			place(undefined);
			return;
		}
		// Already floating and the bounds moved under it (the sidebar folded): glide to where
		// the same share of the column now puts it, rather than jumping there.
		if (current !== undefined && (current.x !== snapped.p.x || current.y !== snapped.p.y)) {
			settle(snapped.p, false);
			return;
		}
		place(snapped.p);
	};

	const unstow = (): void => {
		if (!stowed) return;
		stowed = false;
		saveStowed(key, undefined, storage);
		const saved = loadFloats(storage)[key];
		const back = saved === undefined || saved === "home" ? undefined : clamp(fromSaved(saved, size(), bounds(), home(), 6, pin), size(), bounds());
		if (back === undefined || snapHome(back, home()).home) settle(home(), true);
		else settle(back, false);
	};

	const sendHome = (): void => {
		if (stowed) return;
		remember("home");
		if (current === undefined) {
			place(undefined);
			return;
		}
		settle(home(), true);
	};

	const endDrag = (event: PointerEvent): void => {
		if (!drag || event.pointerId !== drag.pointerId) return;
		const { moved, samples } = drag;
		drag = undefined;
		delete el.dataset.dragging;
		try {
			handle.releasePointerCapture(event.pointerId);
		} catch {
			// Capture may already be gone, as after a pointercancel.
		}
		// A press that did not move is a click, and a click must not turn "home" into a
		// stored position.
		if (!moved || current === undefined) {
			if (current === undefined) place(undefined);
			return;
		}
		// A throw carries on: the velocity at release is projected forward, then the
		// resting place is home if that lands near it, an edge if it lands near one, and
		// inside the bounds whatever else. A placement (the pointer paused before letting
		// go) has no velocity and rests where it was put, edges and home still applying.
		const velocity = velocityFrom(samples, event.timeStamp);
		// Thrown hard at the right edge, it is put away. The position it had before this
		// drag stays saved, because that is where the tab brings it back to.
		if (options.stow && stowsRight(current, velocity, size(), bounds())) {
			stowed = true;
			saveStowed(key, verticalShare(current, size(), bounds(), 6, pin), storage);
			settle(stowedAt(current.y, size(), bounds(), options.stow.tab), false);
			return;
		}
		const thrown = fling(current, velocity);
		const rest = restingPlace(thrown, size(), bounds(), home());
		if (rest.home) {
			remember("home");
			settle(rest.p, true);
			return;
		}
		remember(toFraction(rest.p, size(), bounds(), 6, pin));
		settle(rest.p, false);
	};

	const onPointerDown = (event: PointerEvent): void => {
		if (disabled() || stowed || event.button !== 0 || drag || onIgnored(event.target)) return;
		// Taken mid-glide, it stops where it is and the drag starts from there.
		cancelSettle();
		if (current !== undefined && options.read) current = options.read();
		drag = {
			pointerId: event.pointerId,
			startPointer: { x: event.clientX, y: event.clientY },
			startPos: current ?? home(),
			moved: false,
			samples: [{ x: event.clientX, y: event.clientY, t: event.timeStamp }],
		};
		try {
			handle.setPointerCapture(event.pointerId);
		} catch {
			// Some engines refuse capture for synthetic pointers; the drag still works
			// while the pointer stays over the handle.
		}
		el.dataset.dragging = "true";
		event.preventDefault();
	};

	const onPointerMove = (event: PointerEvent): void => {
		if (!drag || event.pointerId !== drag.pointerId) return;
		const dx = event.clientX - drag.startPointer.x;
		const dy = event.clientY - drag.startPointer.y;
		if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
		drag.moved = true;
		drag.samples.push({ x: event.clientX, y: event.clientY, t: event.timeStamp });
		if (drag.samples.length > SAMPLES) drag.samples.shift();
		// Clamped while moving too, so the float never disappears past an edge mid-drag.
		place(clamp({ x: drag.startPos.x + dx, y: drag.startPos.y + dy }, size(), bounds()));
	};

	const onDoubleClick = (event: MouseEvent): void => {
		if (disabled() || stowed || onIgnored(event.target)) return;
		event.preventDefault();
		sendHome();
	};

	const onResize = (): void => restore();

	handle.addEventListener("pointerdown", onPointerDown);
	handle.addEventListener("pointermove", onPointerMove);
	handle.addEventListener("pointerup", endDrag);
	handle.addEventListener("pointercancel", endDrag);
	handle.addEventListener("dblclick", onDoubleClick);

	let observer: ResizeObserver | undefined;
	try {
		window.addEventListener("resize", onResize);
		if (options.observe && typeof ResizeObserver !== "undefined") {
			observer = new ResizeObserver(onResize);
			observer.observe(options.observe);
		}
	} catch {
		// No window to watch; the caller can still call `restore` itself.
	}

	restore();

	return {
		restore,
		sendHome,
		unstow,
		stowed: () => stowed,
		dispose() {
			handle.removeEventListener("pointerdown", onPointerDown);
			handle.removeEventListener("pointermove", onPointerMove);
			handle.removeEventListener("pointerup", endDrag);
			handle.removeEventListener("pointercancel", endDrag);
			handle.removeEventListener("dblclick", onDoubleClick);
			try {
				window.removeEventListener("resize", onResize);
			} catch {
				// Never attached.
			}
			observer?.disconnect();
			cancelSettle();
			drag = undefined;
			delete el.dataset.dragging;
		},
	};
}
