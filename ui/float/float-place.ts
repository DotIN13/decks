import { avoid, clamp, clearUpward, fromSaved, glideMs, loadFloats, loadStowed, saveFloat, saveStowed, snapHome, stowedAt, toFraction, within, type Pin, type Point, type Sample, type Saved, type Side, type Size } from "./float-math.ts";
import type { FloatOptions } from "./float.ts";

/** How far a tucked float's tab keeps from every other float: the throw bends up until it is this clear. */
const TAB_SAFE_ZONE = 80;

/** The listeners one float keeps on the window and its handle, made once so they can be taken off again. */
export interface Handlers {
	onWindowMove: (event: PointerEvent) => void;
	onWindowUp: (event: PointerEvent) => void;
	onWindowBlur: () => void;
	onTabWindowMove: (event: PointerEvent) => void;
	onTabWindowUp: (event: PointerEvent) => void;
	onTabBlur: () => void;
	onPointerDown: (event: PointerEvent) => void;
	onDoubleClick: (event: MouseEvent) => void;
	onTabDown: (event: PointerEvent) => void;
}

/** One float: its element and options, where it is, what is held, and its glide. */
export interface FloatState extends Pick<FloatOptions, "key" | "handle" | "ignore" | "home" | "bounds" | "size" | "apply" | "onChange" | "storage"> {
	el: HTMLElement;
	options: FloatOptions;
	pin: Pin;
	disabled: () => boolean;
	/** Where the float is now, or `undefined` when the CSS places it at home. */
	current: Point | undefined;
	drag: { pointerId: number; startPointer: Point; startPos: Point; moved: boolean; samples: Sample[] } | undefined;
	/** The edge it is put away behind, or nothing. Where it comes back to is whatever `key` has saved. */
	stowed: Side | undefined;
	/** A glide under way: `[data-snapping]` on, until the transition ends or its timer says it must have. */
	settling: { timer: ReturnType<typeof setTimeout>; finish: (event?: Event) => void } | undefined;
	/** While bounds move step by step: what `restore` measured once, so each step is only arithmetic. */
	following: { size: Size; home: Point; tab: number; saved: Saved | undefined } | undefined;
	tabDrag: { pointerId: number; tab: Element; startPointer: Point; startY: number; moved: boolean } | undefined;
	h: Handlers;
}

export function tabWidth(f: FloatState): number {
	const tab = f.options.stow?.tab ?? 0;
	return typeof tab === "function" ? tab() : tab;
}

export function place(f: FloatState, p: Point | undefined): void {
	f.current = p;
	f.apply(p, p === undefined, p !== undefined ? f.stowed : undefined);
}

/**
 * Clear of the other floats: floating, the nearest clear place; put away, the throw bent
 * up along the edge until its tab is clear (`clearUpward`).
 */
export function clear(f: FloatState, p: Point): Point {
	if (!f.options.others) return p;
	const box = f.bounds();
	const others = f.options.others().flatMap((other) => within(other, box) ?? []);
	const tab = f.options.stow?.tabHeight?.();
	return f.stowed ? clearUpward(p, f.size(), others, box, { gap: TAB_SAFE_ZONE, ...(tab ? { tab } : {}) }) : avoid(p, f.size(), others, box);
}

export function cancelSettle(f: FloatState): void {
	if (!f.settling) return;
	clearTimeout(f.settling.timer);
	f.el.removeEventListener("transitionend", f.settling.finish);
	f.settling = undefined;
	delete f.el.dataset.snapping;
}

export function settle(f: FloatState, p: Point, thenHome: boolean, byHand = false): void {
	cancelSettle(f);
	const ms = glideMs(f.current ?? f.home(), p);
	f.el.style.setProperty("--snap-ms", `${ms}ms`);
	f.el.dataset.snapping = "true";
	place(f, p);
	const finish = (event?: Event): void => {
		// A child's own transition (a border colour, say) ends too, and is not this one.
		if (event && event.target !== f.el) return;
		cancelSettle(f);
		if (byHand) f.options.onSettled?.();
		if (!thenHome) return;
		// The stylesheet's own `left` transition (the dock slides when the sidebar folds)
		// would animate the handoff too, and half the width of a transform is a visible
		// jump. Off for a frame, then back.
		f.el.dataset.landing = "true";
		place(f, undefined);
		try {
			requestAnimationFrame(() => requestAnimationFrame(() => delete f.el.dataset.landing));
		} catch {
			delete f.el.dataset.landing;
		}
	};
	f.settling = { timer: setTimeout(finish, ms + 80), finish };
	f.el.addEventListener("transitionend", finish);
}

export function remember(f: FloatState, saved: Saved): void {
	saveFloat(f.key, saved, f.storage);
	f.onChange?.(saved);
}

export function onIgnored(f: FloatState, target: EventTarget | null): boolean {
	return f.ignore !== undefined && target instanceof Element && target.closest(f.ignore) !== null;
}

export function follow(f: FloatState): void {
	if (f.drag || f.disabled()) return;
	// At home the stylesheet places it, and follows the bounds by itself.
	if (f.current === undefined) return;
	cancelSettle(f);
	f.following ??= { size: f.size(), home: f.home(), tab: tabWidth(f), saved: loadFloats(f.storage)[f.key] };
	const box = f.bounds();
	const { size: sized, home: at, tab, saved } = f.following;
	if (f.stowed) return place(f, stowedAt(f.current.y, sized, box, tab, 12, f.stowed));
	if (saved === undefined || saved === "home") return;
	place(f, clamp(fromSaved(saved, sized, box, at, 6, f.pin), sized, box));
}

export function restore(f: FloatState): void {
	f.following = undefined;
	if (f.drag) return;
	cancelSettle(f);
	if (f.disabled()) {
		// Nothing is thrown where nothing is dragged; it is not forgotten, only not drawn.
		f.stowed = undefined;
		place(f, undefined);
		return;
	}
	const away = f.options.stow ? loadStowed(f.storage)[f.key] : undefined;
	if (f.options.stow && away !== undefined) {
		f.stowed = away.side;
		const y = fromSaved({ fx: 1, fy: away.fy }, f.size(), f.bounds(), f.home(), 6, f.pin).y;
		const p = clear(f, stowedAt(y, f.size(), f.bounds(), tabWidth(f), 12, away.side));
		if (f.current !== undefined && (f.current.x !== p.x || f.current.y !== p.y)) settle(f, p, false);
		else place(f, p);
		return;
	}
	f.stowed = undefined;
	const saved = loadFloats(f.storage)[f.key];
	const first = f.options.stow?.initially;
	if (first && saved === undefined) {
		// Never moved: it starts put away, level with its home.
		f.stowed = first;
		place(f, clear(f, stowedAt(f.home().y, f.size(), f.bounds(), tabWidth(f), 12, first)));
		return;
	}
	if (saved === undefined || saved === "home") {
		place(f, undefined);
		return;
	}
	const p = clamp(fromSaved(saved, f.size(), f.bounds(), f.home(), 6, f.pin), f.size(), f.bounds());
	const snapped = snapHome(p, f.home());
	if (snapped.home) {
		place(f, undefined);
		return;
	}
	snapped.p = clear(f, snapped.p);
	// Already floating and the bounds moved under it (the sidebar folded): glide to where
	// the same share of the column now puts it, rather than jumping there.
	if (f.current !== undefined && (f.current.x !== snapped.p.x || f.current.y !== snapped.p.y)) {
		settle(f, snapped.p, false);
		return;
	}
	place(f, snapped.p);
}

export function unstow(f: FloatState): void {
	if (!f.stowed) return;
	f.stowed = undefined;
	saveStowed(f.key, undefined, f.storage);
	// One that started put away has nothing saved, and taken out it is at home from now on.
	if (f.options.stow?.initially && loadFloats(f.storage)[f.key] === undefined) remember(f, "home");
	const saved = loadFloats(f.storage)[f.key];
	const back = saved === undefined || saved === "home" ? undefined : clamp(fromSaved(saved, f.size(), f.bounds(), f.home(), 6, f.pin), f.size(), f.bounds());
	if (back === undefined || snapHome(back, f.home()).home) settle(f, f.home(), true, true);
	else settle(f, clear(f, back), false, true);
}

export function sendHome(f: FloatState): void {
	if (f.stowed) return;
	remember(f, "home");
	if (f.current === undefined) {
		place(f, undefined);
		return;
	}
	settle(f, f.home(), true, true);
}

/**
 * Stand here, now, and remember it: for a host that moves the float itself, as a resize by its
 * left edge moves its left side. Kept inside the bounds; nothing glides, and a tucked float stays put.
 */
export function placeAt(f: FloatState, p: Point): void {
	if (f.stowed || f.drag) return;
	cancelSettle(f);
	const at = clamp(p, f.size(), f.bounds());
	place(f, at);
	remember(f, toFraction(at, f.size(), f.bounds(), 6, f.pin));
}
