import { Refused, type shapes } from "../../protocol/index.ts";

// Where an item goes: a corner (at), beside or below another item, or the
// free room item.space finds. One gap everywhere: 160 px.

export type Box = shapes.Box;
export type Corner = { x: number; y: number };
export type Size = { w: number; h: number };
export type Side = "right" | "below" | "left" | "above";
export type PlaceArgs = { at?: Corner; beside?: string; below?: string };

export const GAP = 160;

/** The corner a place names, given how to find another item's box. */
export function cornerOf(place: PlaceArgs, boxOf: (id: string) => Box | undefined): Corner | undefined {
	const said = [place.at !== undefined, !!place.beside, !!place.below].filter(Boolean).length;
	if (said > 1) throw new Refused("invalid", "Say one place: at, beside or below.", "item.move");
	if (place.at) {
		const { x, y } = place.at;
		if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Refused("invalid", "at is a corner, as in { x: 1160, y: 0 }.", "item.move");
		return { x, y };
	}
	const ref = place.beside ?? place.below;
	if (!ref) return undefined;
	const box = boxOf(ref);
	if (!box) throw new Refused("not_found", `Nothing called ${ref} is on this canvas to go ${place.beside ? "beside" : "below"}.`, "item.list");
	return place.beside ? besideOf(box) : belowOf(box);
}

export const besideOf = (box: Box): Corner => ({ x: Math.round(box.x2 + GAP), y: Math.round(box.y1) });
export const belowOf = (box: Box): Corner => ({ x: Math.round(box.x1), y: Math.round(box.y2 + GAP) });

const touches = (a: Box, b: Box) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

function inWay(items: readonly Box[], x: number, y: number, size: Size, margin: number): Box[] {
	const grown = { x1: x - margin, y1: y - margin, x2: x + size.w + margin, y2: y + size.h + margin };
	return items.filter((b) => touches(grown, b));
}

/** Room for a box of size: on one side of near, or nearest the middle of everything. */
export function freeCorner(items: readonly Box[], size: Size, options: { near?: Box; side?: Side; margin?: number } = {}): Corner {
	const margin = options.margin ?? GAP;
	const done = (x: number, y: number) => ({ x: Math.round(x), y: Math.round(y) });
	if (options.near) return done(...stepOut(items, size, options.near, options.side ?? "right", margin));
	if (!items.length) return done(0, 0);
	const left = Math.min(...items.map((b) => b.x1)), top = Math.min(...items.map((b) => b.y1));
	const right = Math.max(...items.map((b) => b.x2)), bottom = Math.max(...items.map((b) => b.y2));
	const cx = (left + right) / 2, cy = (top + bottom) / 2;
	const xs = new Set([cx - size.w / 2, ...items.flatMap((b) => [b.x2 + margin, b.x1 - margin - size.w, b.x1])]);
	const ys = new Set([cy - size.h / 2, ...items.flatMap((b) => [b.y2 + margin, b.y1 - margin - size.h, b.y1])]);
	const corners = [...xs].flatMap((x) => [...ys].map((y) => ({ x, y, d: Math.hypot(x + size.w / 2 - cx, y + size.h / 2 - cy) })));
	corners.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
	const free = corners.find((c) => inWay(items, c.x, c.y, size, margin).length === 0);
	return free ? done(free.x, free.y) : done(right + margin, top);
}

/** Start on the side asked for, and step past whatever is in the way. */
function stepOut(items: readonly Box[], size: Size, near: Box, side: Side, margin: number): [number, number] {
	let x = side === "right" ? near.x2 + margin : side === "left" ? near.x1 - margin - size.w : near.x1;
	let y = side === "below" ? near.y2 + margin : side === "above" ? near.y1 - margin - size.h : near.y1;
	for (let step = 0; step <= items.length; step++) {
		const hit = inWay(items, x, y, size, margin);
		if (!hit.length) break;
		if (side === "right") x = Math.max(...hit.map((b) => b.x2)) + margin;
		else if (side === "left") x = Math.min(...hit.map((b) => b.x1)) - margin - size.w;
		else if (side === "below") y = Math.max(...hit.map((b) => b.y2)) + margin;
		else y = Math.min(...hit.map((b) => b.y1)) - margin - size.h;
	}
	return [x, y];
}
