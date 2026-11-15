import type { Box, Pin, Point, Saved, Side, Size } from "./float-math.ts";
import { listen, onDoubleClick, onPointerDown, onWindowBlur, onWindowMove, onWindowUp } from "./float-drag.ts";
import { cancelSettle, follow, placeAt, restore, sendHome, unstow, type FloatState } from "./float-place.ts";
import { listenTab, onTabBlur, onTabDown, onTabWindowMove, onTabWindowUp } from "./float-tab.ts";


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

export function makeFloat(
	el: HTMLElement,
	options: FloatOptions,
): { restore: () => void; follow: () => void; sendHome: () => void; unstow: () => void; stowed: () => boolean; placeAt: (p: Point) => void; dispose: () => void } {
	const { key, handle, ignore, home, bounds, size, apply, onChange, storage } = options;
	const f: FloatState = {
		el, options, key, handle, ignore, home, bounds, size, apply, onChange, storage,
		pin: options.pin ?? "top",
		disabled: () => options.disabled?.() === true,
		current: undefined, drag: undefined, stowed: undefined, settling: undefined, following: undefined, tabDrag: undefined,
		h: undefined as unknown as FloatState["h"],
	};
	f.h = {
		onWindowMove: (event) => onWindowMove(f, event),
		onWindowUp: (event) => onWindowUp(f, event),
		onWindowBlur: () => onWindowBlur(f),
		onTabWindowMove: (event) => onTabWindowMove(f, event),
		onTabWindowUp: (event) => onTabWindowUp(f, event),
		onTabBlur: () => onTabBlur(f),
		onPointerDown: (event) => onPointerDown(f, event),
		onDoubleClick: (event) => onDoubleClick(f, event),
		onTabDown: (event) => onTabDown(f, event),
	};
	const onResize = (): void => restore(f);
	handle.addEventListener("pointerdown", f.h.onPointerDown);
	handle.addEventListener("dblclick", f.h.onDoubleClick);
	if (options.stow) el.addEventListener("pointerdown", f.h.onTabDown);
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
	restore(f);
	return {
		restore: () => restore(f),
		follow: () => follow(f),
		sendHome: () => sendHome(f),
		unstow: () => unstow(f),
		stowed: () => f.stowed !== undefined,
		placeAt: (p) => placeAt(f, p),
		dispose() {
			handle.removeEventListener("pointerdown", f.h.onPointerDown);
			listen(f, false);
			handle.removeEventListener("dblclick", f.h.onDoubleClick);
			el.removeEventListener("pointerdown", f.h.onTabDown);
			listenTab(f, false);
			try {
				window.removeEventListener("resize", onResize);
			} catch {
				// Never attached.
			}
			observer?.disconnect();
			cancelSettle(f);
			f.drag = undefined;
			f.tabDrag = undefined;
			delete el.dataset.dragging;
		},
	};
}
