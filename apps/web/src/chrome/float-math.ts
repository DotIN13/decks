/**
 * The geometry of a float: a small panel the person may drag around a surface.
 *
 * Pure, so it can be tested without a DOM. `float.ts` does the pointer events and calls
 * in here for every number. Two ideas carry the module:
 *
 * A float has a home. Dropped near it, it snaps back and forgets it was ever moved, so a
 * nudge does not turn into a stored position that follows the person across sessions.
 *
 * A moved float is remembered by its nearest corner, not by absolute coordinates. Offsets
 * from the bottom-right corner survive a window resize; a saved `x: 1180` does not.
 */

export interface Point {
	x: number;
	y: number;
}

export interface Size {
	w: number;
	h: number;
}

export interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}

export type Anchor = "tl" | "tr" | "bl" | "br";

/**
 * `"home"` means the CSS places it. Otherwise **where in the column it sits, as a fraction
 * of the room it has** (`fx`, `fy` in 0..1): 0 is against the left or top margin, 1 against
 * the right or bottom, ½ centred. A column that narrows (the sidebar opened) moves a float
 * by a share of the change, the way its home does, rather than by all of it or none.
 *
 * The corner-and-offset form is what an earlier build stored; it is still read.
 */
export type Saved = "home" | { fx: number; fy: number } | { anchor: Anchor; dx: number; dy: number };

/** Where every float's position is remembered, as one JSON object keyed by float. */
export const FLOATS_KEY = "decks.floats";

const ANCHORS: readonly Anchor[] = ["tl", "tr", "bl", "br"];

/**
 * Keep the whole float inside the bounds, `margin` in from every edge. When the float is
 * wider or taller than the room it has, the top-left edge wins: the handle is usually there.
 */
export function clamp(p: Point, size: Size, bounds: Box, margin = 6): Point {
	const minX = bounds.x + margin;
	const minY = bounds.y + margin;
	const maxX = Math.max(minX, bounds.x + bounds.w - size.w - margin);
	const maxY = Math.max(minY, bounds.y + bounds.h - size.h - margin);
	return { x: Math.min(maxX, Math.max(minX, p.x)), y: Math.min(maxY, Math.max(minY, p.y)) };
}

/** Within `radius` of home is home. Straight-line distance, so the snap zone is a circle. */
export function snapHome(p: Point, home: Point, radius = 24): { p: Point; home: boolean } {
	const d = Math.hypot(p.x - home.x, p.y - home.y);
	return d <= radius ? { p: { x: home.x, y: home.y }, home: true } : { p, home: false };
}

/** The corner of `bounds` nearest the float's centre, and the float's inset from it. */
export function toAnchor(p: Point, size: Size, bounds: Box): Saved {
	const cx = p.x + size.w / 2;
	const cy = p.y + size.h / 2;
	const right = cx - bounds.x > bounds.w / 2;
	const bottom = cy - bounds.y > bounds.h / 2;
	const anchor: Anchor = bottom ? (right ? "br" : "bl") : right ? "tr" : "tl";
	const dx = right ? bounds.x + bounds.w - (p.x + size.w) : p.x - bounds.x;
	const dy = bottom ? bounds.y + bounds.h - (p.y + size.h) : p.y - bounds.y;
	return { anchor, dx, dy };
}

/** The room a float has to move in, each axis, once the margin is taken off both sides. */
function room(size: Size, bounds: Box, margin: number): Size {
	return { w: Math.max(0, bounds.w - size.w - 2 * margin), h: Math.max(0, bounds.h - size.h - 2 * margin) };
}

/**
 * Which edge a float's vertical share is measured from. `"bottom"` is for a float whose
 * height changes while it stands (the composer's status row comes and goes above its
 * box): measured from the bottom, the share names where the *box* is, so the same save
 * puts the box in the same place whatever the row is doing at the time.
 */
export type Pin = "top" | "bottom";

/** Where the float sits, as a fraction of the room it has. */
export function toFraction(p: Point, size: Size, bounds: Box, margin = 6, pin: Pin = "top"): Saved {
	const r = room(size, bounds, margin);
	const unit = (value: number) => Math.min(1, Math.max(0, value));
	const span = Math.max(0, bounds.h - 2 * margin);
	return {
		fx: r.w === 0 ? 0 : unit((p.x - bounds.x - margin) / r.w),
		fy:
			pin === "bottom"
				? span === 0
					? 1
					: unit((p.y + size.h - bounds.y - margin) / span)
				: r.h === 0
					? 0
					: unit((p.y - bounds.y - margin) / r.h),
	};
}

/** The vertical share alone: how far down its room a float is, which is all a stowed float keeps. */
export function verticalShare(p: Point, size: Size, bounds: Box, margin = 6, pin: Pin = "top"): number {
	const saved = toFraction(p, size, bounds, margin, pin);
	return typeof saved === "object" && "fy" in saved ? saved.fy : 0;
}

/** Any saved form back to a point; `"home"` is wherever the caller says home is today. */
export function fromSaved(saved: Saved, size: Size, bounds: Box, home: Point, margin = 6, pin: Pin = "top"): Point {
	if (saved === "home") return { x: home.x, y: home.y };
	if ("fx" in saved) {
		const r = room(size, bounds, margin);
		const span = Math.max(0, bounds.h - 2 * margin);
		return {
			x: bounds.x + margin + saved.fx * r.w,
			y: pin === "bottom" ? bounds.y + margin + saved.fy * span - size.h : bounds.y + margin + saved.fy * r.h,
		};
	}
	return fromAnchor(saved, size, bounds, home);
}

/** The inverse of `toAnchor`, for the older saved form. */
export function fromAnchor(saved: Saved, size: Size, bounds: Box, home: Point): Point {
	if (saved === "home") return { x: home.x, y: home.y };
	if ("fx" in saved) return fromSaved(saved, size, bounds, home);
	const right = saved.anchor === "tr" || saved.anchor === "br";
	const bottom = saved.anchor === "bl" || saved.anchor === "br";
	return {
		x: right ? bounds.x + bounds.w - size.w - saved.dx : bounds.x + saved.dx,
		y: bottom ? bounds.y + bounds.h - size.h - saved.dy : bounds.y + saved.dy,
	};
}

function isSaved(value: unknown): value is Saved {
	if (value === "home") return true;
	if (typeof value !== "object" || value === null) return false;
	const v = value as Record<string, unknown>;
	if (typeof v.fx === "number" && Number.isFinite(v.fx) && typeof v.fy === "number" && Number.isFinite(v.fy)) return true;
	return (
		(ANCHORS as readonly unknown[]).includes(v.anchor) &&
		typeof v.dx === "number" &&
		Number.isFinite(v.dx) &&
		typeof v.dy === "number" &&
		Number.isFinite(v.dy)
	);
}

function defaultStorage(): Storage | undefined {
	try {
		return typeof localStorage === "undefined" ? undefined : localStorage;
	} catch {
		return undefined;
	}
}

/**
 * Every remembered float. Garbage in storage, whether unparseable or the wrong shape, is
 * treated as nothing remembered; a corrupt entry must never stop the app from drawing.
 */
export function loadFloats(storage?: Pick<Storage, "getItem">): Record<string, Saved> {
	let raw: string | null;
	try {
		raw = (storage ?? defaultStorage())?.getItem(FLOATS_KEY) ?? null;
	} catch {
		return {};
	}
	if (raw === null) return {};
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return {};
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
	const out: Record<string, Saved> = {};
	for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
		if (isSaved(value)) out[key] = value;
	}
	return out;
}

export function saveFloat(key: string, saved: Saved, storage?: Storage): void {
	const store = storage ?? defaultStorage();
	if (!store) return;
	const floats = loadFloats(store);
	floats[key] = saved;
	try {
		store.setItem(FLOATS_KEY, JSON.stringify(floats));
	} catch {
		// Storage full or refused; the float still moved, it just will not be remembered.
	}
}

/** A pointer position with the time it was seen, for the velocity at release. */
export interface Sample {
	x: number;
	y: number;
	t: number;
}

/** Pixels per millisecond, each axis. */
export interface Velocity {
	vx: number;
	vy: number;
}

/**
 * How fast the pointer was moving when it let go: the displacement over the last `window`
 * milliseconds of samples, and zero when the pointer paused before releasing. A pause is
 * what a person does to *put* something somewhere; a throw is what they do to send it.
 */
export function velocityFrom(samples: readonly Sample[], now: number, window = 100): Velocity {
	const last = samples[samples.length - 1];
	if (!last || now - last.t > window) return { vx: 0, vy: 0 };
	let first = last;
	for (let i = samples.length - 1; i >= 0; i--) {
		const s = samples[i]!;
		if (last.t - s.t > window) break;
		first = s;
	}
	const dt = last.t - first.t;
	if (dt <= 0) return { vx: 0, vy: 0 };
	return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
}

/**
 * Where a thrown float comes to rest on its own: the release point plus the velocity
 * carried for `tau` milliseconds of exponential slowdown, and never further than `max`.
 * Below `min` px/ms the release counts as a place, not a throw, and nothing is added.
 */
export function fling(p: Point, v: Velocity, tau = 260, max = 640, min = 0.25): Point {
	const speed = Math.hypot(v.vx, v.vy);
	if (speed < min) return { x: p.x, y: p.y };
	const distance = Math.min(max, speed * tau);
	return { x: p.x + (v.vx / speed) * distance, y: p.y + (v.vy / speed) * distance };
}

/**
 * The resting place for a point: home if it is near home, else inside the bounds, with an
 * edge it comes close to taking it the rest of the way. Home has the larger radius,
 * because a float thrown *towards* home is meant to arrive.
 */
export function settle(
	p: Point,
	size: Size,
	bounds: Box,
	home: Point,
	options: { homeRadius?: number; edgeRadius?: number; margin?: number } = {},
): { p: Point; home: boolean } {
	const { homeRadius = 72, edgeRadius = 28, margin = 12 } = options;
	const inside = clamp(p, size, bounds, margin);
	const snapped = snapHome(inside, home, homeRadius);
	if (snapped.home) return snapped;
	const minX = bounds.x + margin;
	const maxX = bounds.x + bounds.w - size.w - margin;
	const minY = bounds.y + margin;
	const maxY = bounds.y + bounds.h - size.h - margin;
	const near = (value: number, edge: number): boolean => Math.abs(value - edge) <= edgeRadius;
	return {
		p: {
			x: near(inside.x, minX) ? Math.max(minX, Math.min(maxX, minX)) : near(inside.x, maxX) ? Math.max(minX, maxX) : inside.x,
			y: near(inside.y, minY) ? Math.max(minY, Math.min(maxY, minY)) : near(inside.y, maxY) ? Math.max(minY, maxY) : inside.y,
		},
		home: false,
	};
}

/**
 * Whether a release is a throw at the right edge, hard enough to put the float away.
 *
 * The gesture a phone uses for a video in a corner: flung at the side of the screen, it
 * tucks behind the edge and leaves a tab. Three things have to be true, and each one keeps
 * an ordinary drop from being read as this. It is **fast** (`minSpeed`, in px/ms; a
 * placement has no velocity at all, and a gentle throw towards the right is how a float is
 * parked against that edge). It is **mostly sideways**, so a throw down into the corner is
 * still a throw home. And, carried on, it **reaches the edge**, so a flick from the far
 * side of a wide window moves the float rather than hiding it.
 */
export function stowsRight(p: Point, v: Velocity, size: Size, bounds: Box, options: { minSpeed?: number; tau?: number } = {}): boolean {
	const { minSpeed = 1.2, tau = 260 } = options;
	if (v.vx < minSpeed || v.vx < Math.abs(v.vy) * 1.5) return false;
	return p.x + size.w + v.vx * tau >= bounds.x + bounds.w;
}

/** Where a stowed float stands: past the right edge, with `tab` pixels of it still showing. */
export function stowedAt(y: number, size: Size, bounds: Box, tab: number, margin = 12): Point {
	const inside = clamp({ x: bounds.x, y }, size, bounds, margin);
	return { x: bounds.x + bounds.w - tab, y: inside.y };
}

/**
 * Which floats are put away, and how far down the edge each one's tab is: a share of the
 * height, measured the way `toFraction` measures `fy`. Kept beside the positions rather
 * than in them, because the position is where the float comes *back* to.
 */
export const STOWED_KEY = "decks.stowed";

export function loadStowed(storage?: Pick<Storage, "getItem">): Record<string, number> {
	let parsed: unknown;
	try {
		parsed = JSON.parse((storage ?? defaultStorage())?.getItem(STOWED_KEY) ?? "null");
	} catch {
		return {};
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
	const out: Record<string, number> = {};
	for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
		if (typeof value === "number" && Number.isFinite(value)) out[key] = Math.min(1, Math.max(0, value));
	}
	return out;
}

/** `undefined` takes the float out again. */
export function saveStowed(key: string, fy: number | undefined, storage?: Storage): void {
	const store = storage ?? defaultStorage();
	if (!store) return;
	const stowed = loadStowed(store);
	if (fy === undefined) delete stowed[key];
	else stowed[key] = fy;
	try {
		store.setItem(STOWED_KEY, JSON.stringify(stowed));
	} catch {
		// Not remembered; it is still put away for now.
	}
}

/** How long the glide to a resting place takes: longer for a longer way, within limits. */
export function glideMs(from: Point, to: Point, min = 180, max = 420): number {
	const distance = Math.hypot(to.x - from.x, to.y - from.y);
	return Math.round(Math.min(max, Math.max(min, min + distance * 0.6)));
}

export function clearFloats(storage?: Storage): void {
	try {
		(storage ?? defaultStorage())?.removeItem(FLOATS_KEY);
	} catch {
		// Nothing to clear.
	}
}
