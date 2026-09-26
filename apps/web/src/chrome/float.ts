import {
	type Box,
	type Pin,
	type Point,
	type Sample,
	type Saved,
	type Side,
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
	stowSide,
	avoid,
	within,
	stowY,
	clearUpward,
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
	 * is the edge the float is put away behind, while it is, where `p` leaves only its tab
	 * showing; the caller draws the tab on that side and makes the rest unreachable.
	 */
	apply: (p: Point | undefined, home: boolean, stowed: Side | undefined) => void;
	/**
	 * Let a hard throw at the left or right edge put the float away behind it (`stowSide`),
	 * with `tab` pixels of it left showing. `unstow` on the returned handle brings it back to
	 * where it was. Without this a throw at an edge parks against it, as it always has.
	 */
	stow?: {
		/** How much of it shows when put away: a number, or a function when it depends on the window (a finger's tab is wider). */
		tab: number | (() => number);
		tabHeight?: () => number;
		/**
		 * Put away behind this edge until the person first moves it, rather than at home: where
		 * room is short (a phone), a toolbar starts as its tab. Taken out, it is remembered as
		 * at home, so it does not tuck itself away again.
		 */
		initially?: Side;
	};
	/**
	 * The boxes of the other floats, in the same frame as `bounds`. Wherever this one comes to
	 * rest away from home (dropped, put away, or re-placed after a resize) it takes the
	 * nearest place clear of them (`avoid`). Only what is inside the bounds counts, so a
	 * put-away float is just its tab.
	 */
	others?: () => Box[];
	/**
	 * Called when a move the person made (a drop, a tab pressed, a double-click home) has
	 * finished gliding, so the other floats can step out of its way: home is not moved for
	 * anyone, so whoever is standing there moves instead.
	 */
	onSettled?: () => void;
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

/** How far a tucked float's tab keeps from every other float: the throw bends up until it is this clear. */
const TAB_SAFE_ZONE = 80;

/** Fewer pixels than this and a press was a click, not a drag; nothing is saved. */
const DRAG_THRESHOLD = 3;

/** How far a tucked float's tab must be pulled in off its edge before the float comes out with it. */
const PULL_OUT = 48;

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

	const tabWidth = (): number => {
		const tab = options.stow?.tab ?? 0;
		return typeof tab === "function" ? tab() : tab;
	};

	/** The edge it is put away behind, or nothing. Where it comes back to is whatever `key` has saved. */
	let stowed: Side | undefined;

	const place = (p: Point | undefined): void => {
		current = p;
		apply(p, p === undefined, p !== undefined ? stowed : undefined);
	};

	/**
	 * Clear of the other floats: floating, the nearest clear place; put away, the throw bent
	 * up along the edge until its tab is clear (`clearUpward`).
	 */
	const clear = (p: Point): Point => {
		if (!options.others) return p;
		const box = bounds();
		const others = options.others().flatMap((other) => within(other, box) ?? []);
		const tab = options.stow?.tabHeight?.();
		return stowed ? clearUpward(p, size(), others, box, { gap: TAB_SAFE_ZONE, ...(tab ? { tab } : {}) }) : avoid(p, size(), others, box);
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
	const settle = (p: Point, thenHome: boolean, byHand = false): void => {
		cancelSettle();
		const ms = glideMs(current ?? home(), p);
		el.style.setProperty("--snap-ms", `${ms}ms`);
		el.dataset.snapping = "true";
		place(p);
		const finish = (event?: Event): void => {
			// A child's own transition (a border colour, say) ends too, and is not this one.
			if (event && event.target !== el) return;
			cancelSettle();
			if (byHand) options.onSettled?.();
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
			stowed = undefined;
			place(undefined);
			return;
		}
		const away = options.stow ? loadStowed(storage)[key] : undefined;
		if (options.stow && away !== undefined) {
			stowed = away.side;
			const y = fromSaved({ fx: 1, fy: away.fy }, size(), bounds(), home(), 6, pin).y;
			const p = clear(stowedAt(y, size(), bounds(), tabWidth(), 12, away.side));
			if (current !== undefined && (current.x !== p.x || current.y !== p.y)) settle(p, false);
			else place(p);
			return;
		}
		stowed = undefined;
		const saved = loadFloats(storage)[key];
		const first = options.stow?.initially;
		if (first && saved === undefined) {
			// Never moved: it starts put away, level with its home.
			stowed = first;
			place(clear(stowedAt(home().y, size(), bounds(), tabWidth(), 12, first)));
			return;
		}
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
		snapped.p = clear(snapped.p);
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
		stowed = undefined;
		saveStowed(key, undefined, storage);
		// One that started put away has nothing saved, and taken out it is at home from now on.
		if (options.stow?.initially && loadFloats(storage)[key] === undefined) remember("home");
		const saved = loadFloats(storage)[key];
		const back = saved === undefined || saved === "home" ? undefined : clamp(fromSaved(saved, size(), bounds(), home(), 6, pin), size(), bounds());
		if (back === undefined || snapHome(back, home()).home) settle(home(), true, true);
		else settle(clear(back), false, true);
	};

	const sendHome = (): void => {
		if (stowed) return;
		remember("home");
		if (current === undefined) {
			place(undefined);
			return;
		}
		settle(home(), true, true);
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
		// Thrown hard at its edge, it is put away. The position it had before this drag
		// stays saved, because that is where the tab brings it back to.
		const side = options.stow ? stowSide(current, velocity, size(), bounds()) : undefined;
		if (options.stow && side) {
			stowed = side;
			// Down the edge as far as the throw was heading, bent up only if that is taken.
			const at = clear(stowedAt(stowY(current, velocity, size(), bounds(), side), size(), bounds(), tabWidth(), 12, side));
			saveStowed(key, { fy: verticalShare(at, size(), bounds(), 6, pin), side }, storage);
			settle(at, false, true);
			return;
		}
		const thrown = fling(current, velocity);
		const rest = restingPlace(thrown, size(), bounds(), home());
		if (rest.home) {
			remember("home");
			settle(rest.p, true, true);
			return;
		}
		const clearOf = clear(rest.p);
		remember(toFraction(clearOf, size(), bounds(), 6, pin));
		settle(clearOf, false, true);
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

	/*
	 * The tab of a tucked float is a handle too. Pressed and let go, it is a click, and the
	 * tab's own button brings the float back. Dragged along the edge, the tab goes where it
	 * is put (bent up clear of the others, as a throw is). Pulled in off the edge by
	 * `PULL_OUT`, the float comes out and the rest is an ordinary drag of it.
	 */
	let tabDrag: { pointerId: number; tab: Element; startPointer: Point; startY: number; moved: boolean } | undefined;
	/** A drag of the tab ends in a click on it; that click must not also bring the float back. */
	const swallowClick = (): void => {
		const swallow = (event: Event): void => {
			event.stopPropagation();
			event.preventDefault();
		};
		el.addEventListener("click", swallow, { capture: true, once: true });
		setTimeout(() => el.removeEventListener("click", swallow, { capture: true }), 0);
	};
	const onTabDown = (event: PointerEvent): void => {
		const tab = event.target instanceof Element ? event.target.closest("[data-stowtab]") : null;
		if (!tab || !stowed || current === undefined || disabled() || event.button !== 0 || drag || tabDrag) return;
		cancelSettle();
		tabDrag = { pointerId: event.pointerId, tab, startPointer: { x: event.clientX, y: event.clientY }, startY: current.y, moved: false };
		try {
			tab.setPointerCapture(event.pointerId);
		} catch {
			// Without capture the drag still works while the pointer stays over the tab.
		}
	};
	const onTabMove = (event: PointerEvent): void => {
		if (!tabDrag || event.pointerId !== tabDrag.pointerId || current === undefined || !stowed) return;
		const dx = event.clientX - tabDrag.startPointer.x;
		const dy = event.clientY - tabDrag.startPointer.y;
		if (!tabDrag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
		if (!tabDrag.moved) {
			tabDrag.moved = true;
			el.dataset.dragging = "true";
		}
		const inward = stowed === "right" ? -dx : dx;
		if (inward > PULL_OUT) {
			// Out it comes, held by its own handle: the float jumps so the top middle of the
			// handle (the grip, or the strip along the composer's top) is under the pointer,
			// as if it had been taken there. From here it is an ordinary drag, captured by the
			// handle so the drag's own listeners take it.
			const { pointerId } = tabDrag;
			const box = el.getBoundingClientRect();
			const grip = handle.getBoundingClientRect();
			const held = { x: grip.left - box.left + grip.width / 2, y: grip.top - box.top + Math.min(7, grip.height / 2) };
			try {
				tabDrag.tab.releasePointerCapture(pointerId);
			} catch {
				// Already released.
			}
			swallowClick();
			tabDrag = undefined;
			stowed = undefined;
			saveStowed(key, undefined, storage);
			// Where the handle would be under the pointer; placed inside the bounds, but the drag
			// starts from the unclamped spot, so a wide float that cannot fit there yet catches up
			// with the pointer as soon as it has room, instead of lagging by the difference.
			const grabbed = { x: current.x + event.clientX - (box.left + held.x), y: current.y + event.clientY - (box.top + held.y) };
			const out = clamp(grabbed, size(), bounds());
			place(out);
			drag = {
				pointerId,
				startPointer: { x: event.clientX, y: event.clientY },
				startPos: grabbed,
				moved: true,
				samples: [{ x: event.clientX, y: event.clientY, t: event.timeStamp }],
			};
			try {
				handle.setPointerCapture(pointerId);
			} catch {
				// The drag follows while the pointer is over the handle.
			}
			return;
		}
		const y = clamp({ x: bounds().x, y: tabDrag.startY + dy }, size(), bounds(), 12).y;
		place({ x: current.x, y });
	};
	const onTabUp = (event: PointerEvent): void => {
		if (!tabDrag || event.pointerId !== tabDrag.pointerId) return;
		const { moved, tab } = tabDrag;
		tabDrag = undefined;
		delete el.dataset.dragging;
		try {
			tab.releasePointerCapture(event.pointerId);
		} catch {
			// Capture may already be gone.
		}
		if (!moved || current === undefined || !stowed) return;
		swallowClick();
		const at = clear(current);
		saveStowed(key, { fy: verticalShare(at, size(), bounds(), 6, pin), side: stowed }, storage);
		settle(at, false, true);
	};

	const onResize = (): void => restore();

	handle.addEventListener("pointerdown", onPointerDown);
	handle.addEventListener("pointermove", onPointerMove);
	handle.addEventListener("pointerup", endDrag);
	handle.addEventListener("pointercancel", endDrag);
	handle.addEventListener("dblclick", onDoubleClick);
	if (options.stow) {
		el.addEventListener("pointerdown", onTabDown);
		el.addEventListener("pointermove", onTabMove);
		el.addEventListener("pointerup", onTabUp);
		el.addEventListener("pointercancel", onTabUp);
	}

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
		stowed: () => stowed !== undefined,
		dispose() {
			handle.removeEventListener("pointerdown", onPointerDown);
			handle.removeEventListener("pointermove", onPointerMove);
			handle.removeEventListener("pointerup", endDrag);
			handle.removeEventListener("pointercancel", endDrag);
			handle.removeEventListener("dblclick", onDoubleClick);
			el.removeEventListener("pointerdown", onTabDown);
			el.removeEventListener("pointermove", onTabMove);
			el.removeEventListener("pointerup", onTabUp);
			el.removeEventListener("pointercancel", onTabUp);
			try {
				window.removeEventListener("resize", onResize);
			} catch {
				// Never attached.
			}
			observer?.disconnect();
			cancelSettle();
			drag = undefined;
			tabDrag = undefined;
			delete el.dataset.dragging;
		},
	};
}
