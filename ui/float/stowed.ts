import type { Velocity } from "../velocity.ts";
import { type Box, type Point, type Size, clamp } from "./float-math.ts";
import { defaultStorage } from "./saved.ts";

/**
 * Whether a release is a throw at the right edge, hard enough to tuck the float behind it (as a
 * phone does a video in a corner). It must be fast (`minSpeed`, px/ms; a gentle throw only parks
 * it), mostly sideways (a throw into the corner goes home), and reach the edge if carried on.
 */
export function stowsRight(p: Point, v: Velocity, size: Size, bounds: Box, options: { minSpeed?: number; tau?: number } = {}): boolean {
	const { minSpeed = 1.2, tau = 260 } = options;
	if (v.vx < minSpeed || v.vx < Math.abs(v.vy) * 1.5) return false;
	return p.x + size.w + v.vx * tau >= bounds.x + bounds.w;
}
/** Which edge a float is put away behind. */
export type Side = "left" | "right";
/** The same throw at the left edge: fast, mostly sideways, and carried on it reaches it. */
export function stowsLeft(p: Point, v: Velocity, _size: Size, bounds: Box, options: { minSpeed?: number; tau?: number } = {}): boolean {
	const { minSpeed = 1.2, tau = 260 } = options;
	if (-v.vx < minSpeed || -v.vx < Math.abs(v.vy) * 1.5) return false;
	return p.x + v.vx * tau <= bounds.x;
}
/** Which edge a release puts the float away behind, if either: every float can go either way. */
export function stowSide(p: Point, v: Velocity, size: Size, bounds: Box): Side | undefined {
	if (stowsRight(p, v, size, bounds)) return "right";
	if (stowsLeft(p, v, size, bounds)) return "left";
	return undefined;
}
/** Where a stowed float stands: past its edge, with `tab` pixels of it still showing. */
export function stowedAt(y: number, size: Size, bounds: Box, tab: number, margin = 12, side: Side = "right"): Point {
	const inside = clamp({ x: bounds.x, y }, size, bounds, margin);
	return { x: side === "left" ? bounds.x - size.w + tab : bounds.x + bounds.w - tab, y: inside.y };
}
/**
 * How far down its edge a thrown float lands: where the throw, carried on in a straight line,
 * brings its leading side to the edge, so a throw up and to the right tucks it higher. Kept
 * inside the height.
 */
export function stowY(p: Point, v: Velocity, size: Size, bounds: Box, side: Side, margin = 12): number {
	const run = side === "right" ? bounds.x + bounds.w - (p.x + size.w) : p.x - bounds.x;
	const along = Math.abs(v.vx) > 0 ? (v.vy / Math.abs(v.vx)) * Math.max(0, run) : 0;
	return clamp({ x: bounds.x, y: p.y + along }, size, bounds, margin).y;
}
/**
 * Which floats are put away, behind which edge, and how far down each tab is (a share of the
 * height, as `toFraction` measures `fy`). Kept beside the positions, which are where a float comes
 * back to. A bare number is an earlier build's, when the right edge was the only one.
 */
export const STOWED_KEY = "decks.stowed";
export interface Stowed {
	fy: number;
	side: Side;
}
export function loadStowed(storage?: Pick<Storage, "getItem">): Record<string, Stowed> {
	let parsed: unknown;
	try {
		parsed = JSON.parse((storage ?? defaultStorage())?.getItem(STOWED_KEY) ?? "null");
	} catch {
		return {};
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
	const out: Record<string, Stowed> = {};
	const share = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : undefined);
	for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
		const bare = share(value);
		if (bare !== undefined) {
			out[key] = { fy: bare, side: "right" };
			continue;
		}
		if (typeof value !== "object" || value === null) continue;
		const { fy, side } = value as { fy?: unknown; side?: unknown };
		const at = share(fy);
		if (at !== undefined && (side === "left" || side === "right")) out[key] = { fy: at, side };
	}
	return out;
}
/** `undefined` takes the float out again. */
export function saveStowed(key: string, stowed: Stowed | undefined, storage?: Storage): void {
	const store = storage ?? defaultStorage();
	if (!store) return;
	const all = loadStowed(store);
	if (stowed === undefined) delete all[key];
	else all[key] = stowed;
	try {
		store.setItem(STOWED_KEY, JSON.stringify(all));
	} catch {
		// Not remembered; it is still put away for now.
	}
}
