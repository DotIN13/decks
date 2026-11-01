/**
 * A drop eases in. What a drag let go of glides from where the pointer left it to where it lands,
 * and whatever the layout moved to make room (or to close the gap it left) glides there too: 150 ms,
 * ease-out. The maths is here; the engine runs it at the drawing that answers the drop
 * (`stage/engine.ts`, `settle`), so nothing is drawn where it lands before it has glided there.
 */
import type { Offset, Rect } from "../edit/model.ts";
import type { SceneQuery } from "../edit/scene.ts";
import { SAME } from "../device/rules.ts";

/** How long a landing glides for. */
export const GLIDE_MS = SAME.glideMs;

/** Ease-out, cubic: fast from where it was let go, slow into where it lands. */
export const easeOut = (k: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);

/**
 * Where everything a drop can move is as it is let go: each carried item where the drag has it,
 * and every other child of each frame it leaves or joins, and of each frame those sit in, up to
 * the top, where they are now. Drawn boxes, in stage pixels.
 */
export function landingBoxes(scene: SceneQuery, ids: readonly string[], offset: Offset, into: string | null | undefined): Map<string, Rect> {
	const out = new Map<string, Rect>();
	const boxOf = (id: string) => scene.box(id) ?? scene.item(id)?.box;
	const carried = new Set(ids);
	const holders = new Set<string>();
	for (const id of [...ids.map((one) => scene.item(one)?.parent), into ?? undefined]) {
		for (let up = id; up; up = scene.item(up)?.parent) holders.add(up);
	}
	for (const holder of holders) {
		for (const child of scene.node(holder)?.children ?? []) {
			if (carried.has(child.id)) continue;
			const box = boxOf(child.id);
			if (box) out.set(child.id, box);
		}
	}
	for (const id of ids) {
		const box = boxOf(id);
		if (box) out.set(id, { x: box.x + offset.dx, y: box.y + offset.dy, w: box.w, h: box.h });
	}
	return out;
}

/**
 * How far each item has to glide, from where it was let go (`before`) to where the drawing that
 * answers the drop has it (`after`): only what moved by more than half a pixel, and only the
 * outermost of what moved, since an item carries its children with it.
 */
export function glideShifts(before: ReadonlyMap<string, Rect>, after: (id: string) => Rect | undefined, parent: (id: string) => string | undefined): Map<string, Offset> {
	const moved = new Map<string, Offset>();
	for (const [id, was] of before) {
		const now = after(id);
		if (!now) continue;
		const dx = was.x - now.x;
		const dy = was.y - now.y;
		if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) moved.set(id, { dx, dy });
	}
	for (const id of [...moved.keys()]) {
		for (let up = parent(id); up; up = parent(up)) {
			if (moved.has(up)) {
				moved.delete(id);
				break;
			}
		}
	}
	return moved;
}

/** Each item's offset from where it lands, `elapsed` ms into the glide: all of its shift at 0, none at `GLIDE_MS`. */
export function glideAt(shifts: ReadonlyMap<string, Offset>, elapsed: number): Map<string, Offset> {
	const left = 1 - easeOut(elapsed / GLIDE_MS);
	return new Map([...shifts].map(([id, shift]) => [id, { dx: shift.dx * left, dy: shift.dy * left }]));
}

/*
 * Every change of place glides, whoever made it, the way Pen's editor glides: the drawing jumps and
 * the picture catches up. Each item that moved keeps the difference between where it was drawn and
 * where it is now (`shiftsFrom`), and that difference decays every frame by frame-rate-independent
 * exponential smoothing (`decay`): a 100 px move is 95% there in 150 ms, done under half a pixel.
 * An item that appeared starts a little low and transparent and rises in (`RISE`, `FADE_RATE`).
 * There is no end time: a new drawing mid-glide re-targets from where things are drawn.
 */
/** How fast a moved item's shift decays, per second: half of what is left goes every 50 ms, 95% of a move done in 215 ms. */
export const RATE = 14;
/** How fast an appeared item's rise decays, per second: slower than a move, so it is seen rising through its fade. */
export const RISE_RATE = 7;
/** How fast an appeared item's transparency goes, per second: faded in within about 500 ms. */
export const FADE_RATE = 6;
/** How far below its place an appeared item starts, in stage pixels. */
export const RISE = 40;
/** Under this many pixels a shift is done. */
export const SETTLED_PX = 0.5;
/** Under this much transparency left a fade is done. */
export const SETTLED_FADE = 0.05;
/** More moved items than this (a canvas opened, a reset) jump: a glide of everything says nothing. */
export const MOST_GLIDING = 60;

/** A shift still in hand: how far the item is drawn from where it lands, and, for one that appeared, how much of its transparency is left (1 at first). */
export interface Shift extends Offset {
	fade?: number;
}

/** What is left of `value` after `dt` seconds at rate `k`: exponential smoothing toward zero. */
export const decay = (value: number, k: number, dt: number): number => value * Math.exp(-k * dt);

/**
 * The shifts a new drawing starts: every top-level item drawn somewhere else before (`before`, where
 * it was drawn, offsets included) keeps the difference; one that was not drawn before (it appeared)
 * starts `RISE` below and transparent. Items inside a moved one move with it. Nothing when more than
 * `MOST_GLIDING` moved, which is a whole canvas changing rather than an edit.
 */
export function shiftsFrom(before: ReadonlyMap<string, Rect>, after: (id: string) => Rect | undefined, parent: (id: string) => string | undefined, appeared: readonly string[], fading?: ReadonlyMap<string, number>): Map<string, Shift> {
	const shifts: Map<string, Shift> = glideShifts(before, after, parent);
	for (const id of appeared) {
		if (!before.has(id) && !shifts.has(id)) shifts.set(id, { dx: 0, dy: RISE, fade: 1 });
	}
	/*
	 * An item still fading in from the last drawing keeps what is left of its fade: the new drawing
	 * re-targets its place from where it is drawn, and without this it jumped to opaque the moment
	 * the next edit landed, which an agent sends a few times a second.
	 */
	for (const [id, fade] of fading ?? []) {
		if (!after(id)) continue;
		const held = shifts.get(id);
		if (held) held.fade = fade;
		else shifts.set(id, { dx: 0, dy: 0, fade });
	}
	return shifts.size > MOST_GLIDING ? new Map() : shifts;
}

/**
 * One frame of a glide, `dt` seconds after the last: each shift decayed, each fade decayed. Answers
 * the shifts still in hand, with the settled ones dropped; an empty map ends the glide.
 */
export function glideStep(shifts: ReadonlyMap<string, Shift>, dt: number): Map<string, Shift> {
	const out = new Map<string, Shift>();
	for (const [id, one] of shifts) {
		// An appeared item rises at the slower rate, through its fade; a moved one goes at the move's.
		const rate = one.fade === undefined ? RATE : RISE_RATE;
		const dx = decay(one.dx, rate, dt);
		const dy = decay(one.dy, rate, dt);
		const fade = one.fade === undefined ? undefined : decay(one.fade, FADE_RATE, dt);
		const moving = Math.abs(dx) >= SETTLED_PX || Math.abs(dy) >= SETTLED_PX;
		const fading = fade !== undefined && fade >= SETTLED_FADE;
		if (!moving && !fading) continue;
		out.set(id, { dx: moving ? dx : 0, dy: moving ? dy : 0, ...(fading ? { fade } : {}) });
	}
	return out;
}
