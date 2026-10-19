/**
 * Where a drag would drop what it carries: which frame, and where among a frame's children.
 */
import { isShape, type PenNode } from "@decks/pen";
import type { Pt, Rect } from "./model.ts";
import type { SceneQuery } from "./scene.ts";

/**
 * The topmost frame under a point. Only frames that place their children where they say, unless
 * `stacking`, which counts frames that lay their children out too. Never an instance's inside or
 * a library shape.
 */
export function frameAt(scene: SceneQuery, point: Pt, stacking = false): string | undefined {
	let best: { id: string; order: number } | undefined;
	for (const placed of scene.items()) {
		const { node, box } = placed;
		if (node.type !== "frame" || node.id.includes("/") || isShape(node)) continue;
		if (node.layout !== "none" && !stacking) continue;
		if (point.x < box.x || point.x > box.x + box.w || point.y < box.y || point.y > box.y + box.h) continue;
		if (!best || placed.order > best.order) best = { id: node.id, order: placed.order };
	}
	return best?.id;
}

/** The frame under a point that a drag could drop into: never one of the items being carried, and never inside one. `null` is the stage. */
export function frameUnder(scene: SceneQuery, point: Pt, carrying: readonly string[]): string | null {
	const found = frameAt(scene, point, true);
	if (!found) return null;
	if (carrying.includes(found)) return null;
	// Its own descendant would be a loop, which the op refuses anyway; this keeps it off the screen too.
	for (let up = scene.item(found)?.parent; up; up = scene.item(up)?.parent) if (carrying.includes(up)) return null;
	return found;
}

/**
 * Where in a frame that arranges its children a drop would land: the place among them nearest
 * the pointer, and the line drawn on that boundary. `undefined` for a frame with no layout,
 * where an item lands on the pixel it was let go on and there is no order to join.
 *
 * The index counts the frame's own children, carried ones included, so it is an index the `move`
 * op can take; a carried child is only skipped when asking which side of it the pointer is.
 */
export function dropSlot(scene: SceneQuery, frameId: string, point: Pt, carrying: readonly string[]): { index: number; line: Rect } | undefined {
	const frame = laidOut(scene, frameId);
	if (!frame) return undefined;
	const { down, kids } = frame;
	const along = down ? point.y : point.x;
	let index = kids.length;
	for (const [at, kid] of kids.entries()) {
		if (!kid.box || carrying.includes(kid.id)) continue;
		if (along < (down ? kid.box.y + kid.box.h / 2 : kid.box.x + kid.box.w / 2)) {
			index = at;
			break;
		}
	}
	const real = (from: number, step: number) => {
		for (let at = from; at >= 0 && at < kids.length; at += step) {
			const kid = kids[at]!;
			if (kid.box && !carrying.includes(kid.id)) return kid.box;
		}
		return undefined;
	};
	return { index, line: slotLine(frame, real(index - 1, -1), real(index, 1)) };
}

/** A frame that arranges its children, as a drop asks of it: which way, its box and padding, its children as drawn. */
type LaidOut = { node: PenNode; box: Rect; down: boolean; kids: { id: string; box: Rect | undefined }[] };

function laidOut(scene: SceneQuery, frameId: string): LaidOut | undefined {
	const placed = scene.item(frameId);
	const flow = placed?.node.layout;
	if (!placed || (flow !== "vertical" && flow !== "horizontal")) return undefined;
	const kids = (scene.node(frameId)?.children ?? []).map((child) => ({ id: child.id, box: scene.box(child.id) ?? scene.item(child.id)?.box }));
	return { node: placed.node, box: scene.box(frameId) ?? placed.box, down: flow === "vertical", kids };
}

/**
 * The line a slot is drawn as, between the child before it and the child after it (either may be
 * missing): halfway between two, 5 past the one there is at an end, the middle of an empty frame.
 * As long as the frame's content is wide: inside its padding, so the line spans the words, not the paper.
 */
function slotLine(frame: LaidOut, before: Rect | undefined, after: Rect | undefined): Rect {
	const { box, down, node } = frame;
	const edge = (one: Rect, end: boolean) => (down ? one.y + (end ? one.h : 0) : one.x + (end ? one.w : 0));
	const on = before && after ? (edge(before, true) + edge(after, false)) / 2 : after ? edge(after, false) - 5 : before ? edge(before, true) + 5 : down ? box.y + box.h / 2 : box.x + box.w / 2;
	const pad = node.padding;
	const [pt, pr, pb, pl] = typeof pad === "number" ? [pad, pad, pad, pad] : Array.isArray(pad) ? (pad.length === 2 ? [pad[0], pad[1], pad[0], pad[1]] : pad.length === 4 ? pad : [8, 8, 8, 8]) : [8, 8, 8, 8];
	const inset = (value: unknown) => Math.max(8, typeof value === "number" ? value : 8);
	return down ? { x: box.x + inset(pl), y: on, w: Math.max(8, box.w - inset(pl) - inset(pr)), h: 0 } : { x: on, y: box.y + inset(pt), w: 0, h: Math.max(8, box.h - inset(pt) - inset(pb)) };
}

/** Screen pixels round the pointer within which a drag shows the places it could drop into. */
export const NEAR_PX = 200;

/** Every place a drag could land near the pointer: slot lines in frames that arrange their children, and frames that do not. */
export type NearDrops = { slots: readonly Rect[]; frames: readonly Rect[] };

/**
 * What a drag could drop into, within `reach` stage pixels of the pointer (`NEAR_PX` over the
 * zoom): each slot of every frame that arranges its children whose line passes that near, and
 * every frame that places them where they say whose box does. The frames `frameUnder` could
 * answer: never what is carried or inside it, an instance's inside or a library shape. Not the
 * slot the drag would take now (`current`, drawn solid) nor the frame it would drop into (`into`).
 */
export function nearDrops(scene: SceneQuery, point: Pt, carrying: readonly string[], reach: number, current?: { into?: string | null | undefined; line?: Rect | undefined }): NearDrops {
	const slots: Rect[] = [];
	const frames: Rect[] = [];
	const carried = (id: string) => {
		for (let up: string | undefined = id; up; up = scene.item(up)?.parent) if (carrying.includes(up)) return true;
		return false;
	};
	const same = (a: Rect, b: Rect | undefined) => !!b && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5;
	for (const { node, box: placedBox } of scene.items()) {
		if (node.type !== "frame" || node.id.includes("/") || isShape(node) || carried(node.id)) continue;
		const frame = laidOut(scene, node.id);
		if (!frame) {
			if (node.layout !== "none" || node.id === current?.into) continue;
			const box = scene.box(node.id) ?? placedBox;
			if (boxDistance(point, box) <= reach) frames.push(box);
			continue;
		}
		const rows = frame.kids.filter((kid) => kid.box && !carrying.includes(kid.id)).map((kid) => kid.box!);
		for (let at = 0; at <= rows.length; at++) {
			const line = slotLine(frame, rows[at - 1], rows[at]);
			if (same(line, current?.line)) continue;
			if (lineDistance(point, line) <= reach) slots.push(line);
		}
	}
	return { slots, frames };
}

/** How far a point is from a box: 0 inside it. */
export function boxDistance(p: Pt, box: Rect): number {
	return Math.hypot(Math.max(box.x - p.x, 0, p.x - box.x - box.w), Math.max(box.y - p.y, 0, p.y - box.y - box.h));
}

/** How far a point is from a slot's line (a box with no width or no height). */
const lineDistance = (p: Pt, line: Rect) => boxDistance(p, line);
