/**
 * Resizing by the handles: an item's eight, a board's eight, and an item's corner radius. Each
 * move of the pointer is one call here (`resizeStep`, `boardResizeStep`, `radiusAt`), with the
 * box the drag started from and how far the pointer has gone; letting go is an op builder
 * (`resizeOp`, `hugAgainOp`, `radiusOp`). The pointer loop itself is the page's.
 */
import { isCard, isMarkdown, isShape, maxRadius, NOTE_PAD, shapeRadius, type Op, type PenNode } from "@decks/pen";
import { snapEdges, type Guide } from "../../pen/snap.ts";
import type { Pt, Rect } from "./model.ts";

/** The eight handles round a single selection, by the edges each one moves. */
export const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
export type Handle = (typeof HANDLES)[number];
export type Edge = "x1" | "x2" | "y1" | "y2";
type Edges = { x1: number; y1: number; x2: number; y2: number };

/** What the keys held say about a resize: Shift keeps the shape, ⌘ or Ctrl (`free`) turns snapping off. */
export type ResizeMods = { shift?: boolean; free?: boolean };

/** What a resize snaps to: the boxes around it, and how near is near, in stage units. */
export type SnapOptions = { targets: readonly Rect[]; threshold: number };

/** Never smaller than a board can be. */
export const BOARD_MIN = { w: 320, h: 200 };

/** The edges a handle drags. A slide deck's height follows from its width, so it has no top or bottom edge. */
export function handleEdges(handle: Handle, slides = false): Edge[] {
	return [
		...(handle.includes("w") ? (["x1"] as const) : []),
		...(handle.includes("e") ? (["x2"] as const) : []),
		...(!slides && handle.includes("n") ? (["y1"] as const) : []),
		...(!slides && handle.includes("s") ? (["y2"] as const) : []),
	];
}

/** The box's edges with the handle's ones moved by the pointer. */
function dragged(start: Rect, handle: Handle, delta: Pt, slides: boolean): Edges {
	return {
		x1: start.x + (handle.includes("w") ? delta.x : 0),
		x2: start.x + start.w + (handle.includes("e") ? delta.x : 0),
		y1: start.y + (!slides && handle.includes("n") ? delta.y : 0),
		y2: start.y + start.h + (!slides && handle.includes("s") ? delta.y : 0),
	};
}

/** The edges being dragged snap to what is around, unless ⌘ or Ctrl is held. */
function snapped(box: Edges, edges: readonly Edge[], mods: ResizeMods, snap: SnapOptions): { box: Edges; guides: Guide[] } {
	if (mods.free) return { box, guides: [] };
	return snapEdges(box, edges, snap.targets, snap.threshold);
}

/** Shift on a corner keeps the shape: the wider of the two changes sets both, the opposite corner stays. */
function keepShape(box: Edges, start: Rect, handle: Handle): Edges {
	let { x1, y1, x2, y2 } = box;
	const scale = Math.max((x2 - x1) / start.w, (y2 - y1) / start.h);
	if (handle.includes("w")) x1 = x2 - start.w * scale;
	else x2 = x1 + start.w * scale;
	if (handle.includes("n")) y1 = y2 - start.h * scale;
	else y2 = y1 + start.h * scale;
	return { x1, y1, x2, y2 };
}

/**
 * One move of an item's handle: the box it is drawn at now, and the guides to draw. The dragged
 * edges snap first, then Shift on a corner keeps the start's shape (so a snapped edge can be moved
 * off its guide again by the aspect), then the box is rounded, never under 4 wide or `floor` tall.
 * Dragged past the opposite edge, the box flips.
 */
export function resizeStep(start: Rect, handle: Handle, delta: Pt, mods: ResizeMods, options: SnapOptions & { floor?: number }): { box: Rect; guides: Guide[] } {
	const moved = snapped(dragged(start, handle, delta, false), handleEdges(handle), mods, options);
	let { x1, y1, x2, y2 } = moved.box;
	if (mods.shift && handle.length === 2 && start.w > 0 && start.h > 0) ({ x1, y1, x2, y2 } = keepShape({ x1, y1, x2, y2 }, start, handle));
	const floor = options.floor ?? 4;
	return {
		box: { x: Math.round(Math.min(x1, x2)), y: Math.round(Math.min(y1, y2)), w: Math.max(4, Math.round(Math.abs(x2 - x1))), h: Math.max(floor, Math.round(Math.abs(y2 - y1))) },
		guides: moved.guides,
	};
}

/**
 * One move of a board's handle. As an item's, but the edge being dragged stops at `BOARD_MIN`
 * (the other stays put) rather than flipping, and a slide deck is sized by its width alone: its
 * top and bottom do not move, Shift does nothing, and its height keeps the start's aspect.
 */
export function boardResizeStep(start: Rect, handle: Handle, delta: Pt, mods: ResizeMods, options: SnapOptions & { slides?: boolean }): { box: Rect; guides: Guide[] } {
	const slides = !!options.slides;
	const moved = snapped(dragged(start, handle, delta, slides), handleEdges(handle, slides), mods, options);
	let { x1, y1, x2, y2 } = moved.box;
	if (!slides && mods.shift && handle.length === 2) ({ x1, y1, x2, y2 } = keepShape({ x1, y1, x2, y2 }, start, handle));
	if (x2 - x1 < BOARD_MIN.w) {
		if (handle.includes("w")) x1 = x2 - BOARD_MIN.w;
		else x2 = x1 + BOARD_MIN.w;
	}
	if (!slides && y2 - y1 < BOARD_MIN.h) {
		if (handle.includes("n")) y1 = y2 - BOARD_MIN.h;
		else y2 = y1 + BOARD_MIN.h;
	}
	const w = Math.round(x2 - x1);
	return { box: { x: Math.round(x1), y: Math.round(y1), w, h: slides ? Math.round((start.h * w) / start.w) : Math.round(y2 - y1) }, guides: moved.guides };
}

/** What a board's resize changed, on the lift: where it moved to, if a left or top edge was dragged, and its new size. */
export function boardResizeEnd(start: Rect, next: Rect): { move?: Pt; size?: { w: number; h: number } } {
	return {
		...(next.x !== start.x || next.y !== start.y ? { move: { x: next.x, y: next.y } } : {}),
		...(next.w !== start.w || next.h !== start.h ? { size: { w: next.w, h: next.h } } : {}),
	};
}

/**
 * The box the file sizes for an item drawn at `drawn`. The handles are on what the item draws; the
 * file sizes the box it was given (`given`, as placed). For most items they are the same box. For a
 * path drawn in a corner of its viewBox they are not, and the given box is scaled by as much as the
 * drawn one (from `start`), about the same point.
 */
export function givenFor(start: Rect, given: Rect, drawn: Rect): Rect {
	const sx = start.w > 0 ? drawn.w / start.w : 1;
	const sy = start.h > 0 ? drawn.h / start.h : 1;
	return { x: drawn.x - (start.x - given.x) * sx, y: drawn.y - (start.y - given.y) * sy, w: given.w * sx, h: given.h * sy };
}

/**
 * A markdown card as tall as its words, which is how one starts: no `height` of its own, so the
 * layout measures what it says at whatever width it has. Dragging its top or bottom handle pins a
 * height on it, and from then on it is an ordinary box.
 */
export function hugsWords(node: PenNode | undefined): boolean {
	return !!node && (isMarkdown(node) || isCard(node)) && typeof node.height !== "number";
}

/**
 * Whether a drag of this handle leaves a card's height to its words: only its sides. The top and
 * bottom handles are what pin a height on it, and a corner pins one too, since it drags an edge of each.
 */
export function keepsWords(node: PenNode | undefined, handle: Handle): boolean {
	return hugsWords(node) && !handle.includes("n") && !handle.includes("s");
}

/** The least height a resize leaves: a card's own padding twice over, which is a card with no room for a word; 4 for anything else. */
export function sizeFloor(node: PenNode | undefined): number {
	return node && (isMarkdown(node) || isCard(node)) ? NOTE_PAD * 2 : 4;
}

/** How the drawing previews a resize: moved from where it was given, at the new size; a card following its words without a height, so it re-measures them. */
export function resizePreview(given: Rect, box: Rect, words: boolean): { dx: number; dy: number; w: number; h?: number } {
	return { dx: box.x - given.x, dy: box.y - given.y, w: box.w, ...(words ? {} : { h: box.h }) };
}

/** The edit a resize writes on the lift, to a tenth of a pixel: a card still following its words gets its width alone, and no height. */
export function resizeOp(id: string, box: Rect, words: boolean): Op {
	const r = (n: number) => Math.round(n * 10) / 10;
	if (words) return { op: "update", id, box: { x1: r(box.x), y1: r(box.y), x2: r(box.x + box.w) } };
	return { op: "update", id, box: { x1: r(box.x), y1: r(box.y), x2: r(box.x + box.w), y2: r(box.y + box.h) } };
}

/**
 * A double-click on a frame's or a card's top or bottom handle: it hugs what it holds again, with
 * the floor it had (`fit_content(N)`), or 120 for a frame and 48 for a card when it had none. A
 * drag of either edge is what fixed its height; this undoes it. Nothing for any other handle, a
 * library shape, or anything that is not a frame.
 */
export function hugAgainOp(id: string, node: PenNode | undefined, handle: Handle): Op | undefined {
	if (handle !== "n" && handle !== "s") return undefined;
	if (!node || node.type !== "frame" || isShape(node)) return undefined;
	const had = typeof node.height === "string" ? /^fit_content\(\s*([\d.]+)\s*\)$/.exec(node.height)?.[1] : undefined;
	const floor = had ? Number(had) : isCard(node) ? 48 : 120;
	return { op: "update", id, set: { height: `fit_content(${floor})` } };
}

/** Where a corner radius drag starts: the radius now, the most it can be, and whether a library shape keeps it. */
export type RadiusStart = Rect & { radius: number; most: number; shape: boolean };

/**
 * The radius handle for an item at `box`, when it has corners to round: a rounded shape from the
 * library (its own `metadata.radius`), or pen's own rectangle or frame (`cornerRadius`). Nothing
 * when the box is too small to round (`most` under 2), or for a library shape with no corners.
 */
export function radiusStart<B extends Rect>(node: PenNode, box: B): (B & RadiusStart) | undefined {
	const most = maxRadius(box.w, box.h);
	if (most < 2) return undefined;
	const shape = shapeRadius(node);
	if (shape !== undefined) return { ...box, radius: shape, most, shape: true };
	if (isShape(node) || (node.type !== "rectangle" && node.type !== "frame")) return undefined;
	const set = Array.isArray(node.cornerRadius) ? node.cornerRadius[0] : node.cornerRadius;
	const now = typeof set === "number" && Number.isFinite(set) ? set : 0;
	return { ...box, radius: Math.max(0, Math.min(now, most)), most, shape: false };
}

/**
 * The radius for the pointer at `at`: along the diagonal from the top-left corner, the nearer of
 * the two reaches (so a pull across rounds as much as a pull down), rounded, from 0 up to half the
 * shorter side.
 */
export function radiusAt(start: Pick<RadiusStart, "x" | "y" | "most">, at: Pt): number {
	const reach = Math.min(at.x - start.x, at.y - start.y);
	return Math.max(0, Math.min(Math.round(reach), Math.floor(start.most)));
}

/** The edit a radius drag writes: a library shape's `metadata.radius`, or pen's `cornerRadius` (taken off at 0). */
export function radiusOp(id: string, radius: number, shape: boolean, node: PenNode | undefined): Op {
	if (!shape) return { op: "update", id, set: { cornerRadius: radius <= 0 ? null : radius } };
	return { op: "update", id, set: { metadata: { type: "", ...node?.metadata, radius } } };
}
