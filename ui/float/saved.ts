import { ANCHORS, type Anchor, type Box, type Pin, type Point, type Size, room } from "./float-math.ts";

/**
 * `"home"`: the CSS places it. Otherwise where in the column it sits as a fraction of its room
 * (`fx`, `fy` in 0..1, ½ centred), so a column that narrows moves it by a share of the change.
 * The corner-and-offset form is what an earlier build stored; it is still read.
 */
export type Saved = "home" | { fx: number; fy: number } | { anchor: Anchor; dx: number; dy: number };
/** Where every float's position is remembered, as one JSON object keyed by float. */
export const FLOATS_KEY = "decks.floats";
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
/** A corner-anchored save back to a point, for the older saved form. */
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
export function defaultStorage(): Storage | undefined {
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
