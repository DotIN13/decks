import type { Velocity } from "../velocity.ts";
import { type Saved } from "./saved.ts";
export { type Saved, FLOATS_KEY, fromSaved, fromAnchor, loadFloats, saveFloat } from "./saved.ts";
export { stowsRight, type Side, stowsLeft, stowSide, stowedAt, stowY, STOWED_KEY, type Stowed, loadStowed, saveStowed } from "./stowed.ts";

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
export const ANCHORS: readonly Anchor[] = ["tl", "tr", "bl", "br"];
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
/** The room a float has to move in, each axis, once the margin is taken off both sides. */
export function room(size: Size, bounds: Box, margin: number): Size {
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
export { velocityFrom, type Sample, type Velocity } from "../velocity.ts";
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
 * A tucked float that would cover another, turned up a little at a time: the throw's
 * direction bends upward in `step` pixel steps along the edge until it is clear. Only the
 * tab shows of a tucked float, so only the tab counts: `tab` is its height, centred on the
 * float, and `others` are what shows of the others (their tabs, if they are tucked too).
 * It only ever goes up, and never past the top margin; with no room above, `p` stands
 * where the throw sent it.
 */
export function clearUpward(p: Point, size: Size, others: readonly Box[], bounds: Box, options: { tab?: number; gap?: number; margin?: number; step?: number } = {}): Point {
	const { tab = size.h, gap = 8, margin = 12, step = 4 } = options;
	const inset = (size.h - tab) / 2;
	const hits = (q: Point): boolean =>
		others.some((o) => q.x < o.x + o.w + gap && q.x + size.w + gap > o.x && q.y + inset < o.y + o.h + gap && q.y + inset + tab + gap > o.y);
	for (let y = p.y; y + inset >= bounds.y + margin - 0.5; y -= step) if (!hits({ x: p.x, y })) return { x: p.x, y };
	return p;
}
/**
 * Keep a float off the others. `p` is where it would rest; `others` are the boxes the other
 * floats stand in (only the part inside the bounds, so a put-away one is just its tab). If
 * `p` overlaps none of them, with `gap` between, it stands. Otherwise it takes the nearest
 * place beside one of them (above, below, left or right) that is inside the bounds and
 * clear of all of them. With nowhere clear, `p`. A put-away float uses `clearUpward` instead.
 */
export function avoid(p: Point, size: Size, others: readonly Box[], bounds: Box, options: { gap?: number; margin?: number } = {}): Point {
	const { gap = 8, margin = 12 } = options;
	const hits = (q: Point): boolean =>
		others.some((o) => q.x < o.x + o.w + gap && q.x + size.w + gap > o.x && q.y < o.y + o.h + gap && q.y + size.h + gap > o.y);
	if (!hits(p)) return p;
	const fits = (q: Point): boolean =>
		q.y >= bounds.y + margin - 0.5 &&
		q.y + size.h <= bounds.y + bounds.h - margin + 0.5 &&
		q.x >= bounds.x + margin - 0.5 &&
		q.x + size.w <= bounds.x + bounds.w - margin + 0.5;
	const candidates: Point[] = [];
	for (const o of others) {
		candidates.push({ x: p.x, y: o.y - gap - size.h }, { x: p.x, y: o.y + o.h + gap }, { x: o.x - gap - size.w, y: p.y }, { x: o.x + o.w + gap, y: p.y });
	}
	let best: Point | undefined;
	let bestDistance = Infinity;
	for (const q of candidates) {
		if (!fits(q) || hits(q)) continue;
		const distance = Math.hypot(q.x - p.x, q.y - p.y);
		if (distance < bestDistance) {
			best = q;
			bestDistance = distance;
		}
	}
	return best ?? p;
}
/** A box cut to the bounds: what of it can be run into. `undefined` when none of it is inside. */
export function within(box: Box, bounds: Box): Box | undefined {
	const x1 = Math.max(box.x, bounds.x);
	const y1 = Math.max(box.y, bounds.y);
	const x2 = Math.min(box.x + box.w, bounds.x + bounds.w);
	const y2 = Math.min(box.y + box.h, bounds.y + bounds.h);
	return x2 > x1 && y2 > y1 ? { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } : undefined;
}
/** How long the glide to a resting place takes: longer for a longer way, within limits. */
export function glideMs(from: Point, to: Point, min = 180, max = 420): number {
	const distance = Math.hypot(to.x - from.x, to.y - from.y);
	return Math.round(Math.min(max, Math.max(min, min + distance * 0.6)));
}
