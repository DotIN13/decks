/**
 * Resizing by the handles: an item's eight, a board's eight, and an item's corner radius. Each
 * move of the pointer is one call here (`resizeStep`, `pageResizeStep`, `radiusAt`), with the
 * box the drag started from and how far the pointer has gone; letting go is an op builder
 * (`resizeOp`, `hugAgainOp`, `radiusOp`). The pointer loop itself is the page's.
 */
import { isCard, isMarkdown, isShape, maxRadius, NOTE_PAD, shapeRadius, type Op, type PenNode } from "@decks/pen";
import { snapEdges, type Guide } from "../snap.ts";
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
export const PAGE_MIN = { w: 320, h: 200 };

/** The edges a handle drags. */
export function handleEdges(handle: Handle): Edge[] {
	return [
		...(handle.includes("w") ? (["x1"] as const) : []),
		...(handle.includes("e") ? (["x2"] as const) : []),
		...(handle.includes("n") ? (["y1"] as const) : []),
		...(handle.includes("s") ? (["y2"] as const) : []),
	];
}

/** The box's edges with the handle's ones moved by the pointer. */
function dragged(start: Rect, handle: Handle, delta: Pt): Edges {
	return {
		x1: start.x + (handle.includes("w") ? delta.x : 0),
		x2: start.x + start.w + (handle.includes("e") ? delta.x : 0),
		y1: start.y + (handle.includes("n") ? delta.y : 0),
		y2: start.y + start.h + (handle.includes("s") ? delta.y : 0),
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
 * Shift on a corner, then snapping: the shape is kept first, then whichever of the two dragged edges
 * is nearer a line snaps to it and the other follows the shape. So a snapped edge stays on the guide
 * drawn for it, which snapping first and keeping the shape after did not promise.
 */
function snappedShape(box: Edges, start: Rect, handle: Handle, mods: ResizeMods, snap: SnapOptions): { box: Edges; guides: Guide[] } {
	const shaped = keepShape(box, start, handle);
	if (mods.free) return { box: shaped, guides: [] };
	const xEdge: Edge = handle.includes("w") ? "x1" : "x2";
	const yEdge: Edge = handle.includes("n") ? "y1" : "y2";
	const byX = snapEdges(shaped, [xEdge], snap.targets, snap.threshold);
	const byY = snapEdges(shaped, [yEdge], snap.targets, snap.threshold);
	const dx = byX.guides.length ? Math.abs(byX.box[xEdge] - shaped[xEdge]) : Infinity;
	const dy = byY.guides.length ? Math.abs(byY.box[yEdge] - shaped[yEdge]) : Infinity;
	if (dx === Infinity && dy === Infinity) return { box: shaped, guides: [] };
	const out = { ...shaped };
	if (dx <= dy) {
		out[xEdge] = byX.box[xEdge];
		const h = (start.h * Math.abs(out.x2 - out.x1)) / start.w;
		if (yEdge === "y1") out.y1 = out.y2 - h;
		else out.y2 = out.y1 + h;
	} else {
		out[yEdge] = byY.box[yEdge];
		const w = (start.w * Math.abs(out.y2 - out.y1)) / start.h;
		if (xEdge === "x1") out.x1 = out.x2 - w;
		else out.x2 = out.x1 + w;
	}
	// The guide drawn round the box as it now is, on the edge that snapped.
	return { box: out, guides: snapEdges(out, [dx <= dy ? xEdge : yEdge], snap.targets, 0.01).guides };
}

/**
 * One move of an item's handle: the box it is drawn at now, and the guides to draw. The dragged
 * edges snap; with Shift on a corner the start's shape is kept first and the nearer edge snaps
 * after, the other following, so a snapped edge stays on its guide. Then the box is rounded, never
 * under `narrowest` wide (4, or a card's least) nor `floor` tall. Dragged past the opposite edge,
 * the box flips, unless that would take it under a card's least width.
 */
export function resizeStep(start: Rect, handle: Handle, delta: Pt, mods: ResizeMods, options: SnapOptions & { floor?: number; narrowest?: number }): { box: Rect; guides: Guide[] } {
	const shaping = mods.shift && handle.length === 2 && start.w > 0 && start.h > 0;
	const moved = shaping ? snappedShape(dragged(start, handle, delta), start, handle, mods, options) : snapped(dragged(start, handle, delta), handleEdges(handle), mods, options);
	let { x1, y1, x2, y2 } = moved.box;
	const narrowest = options.narrowest ?? 4;
	// A card's least width holds the edge that is not dragged where it is, rather than flipping the card.
	if (narrowest > 4 && x2 - x1 < narrowest) {
		if (handle.includes("w")) x1 = x2 - narrowest;
		else if (handle.includes("e")) x2 = x1 + narrowest;
	}
	const floor = options.floor ?? 4;
	return {
		box: { x: Math.round(Math.min(x1, x2)), y: Math.round(Math.min(y1, y2)), w: Math.max(narrowest, Math.round(Math.abs(x2 - x1))), h: Math.max(floor, Math.round(Math.abs(y2 - y1))) },
		guides: moved.guides,
	};
}

/**
 * One move of a board's handle. As an item's, but the edge being dragged stops at `PAGE_MIN`
 * (the other stays put) rather than flipping.
 */
export function pageResizeStep(start: Rect, handle: Handle, delta: Pt, mods: ResizeMods, options: SnapOptions): { box: Rect; guides: Guide[] } {
	// Shift on a corner keeps the shape, and snaps after it (`snappedShape`); never for a board with no size to keep.
	const shaping = mods.shift && handle.length === 2 && start.w > 0 && start.h > 0;
	const moved = shaping ? snappedShape(dragged(start, handle, delta), start, handle, mods, options) : snapped(dragged(start, handle, delta), handleEdges(handle), mods, options);
	let { x1, y1, x2, y2 } = moved.box;
	if (x2 - x1 < PAGE_MIN.w) {
		if (handle.includes("w")) x1 = x2 - PAGE_MIN.w;
		else x2 = x1 + PAGE_MIN.w;
	}
	if (y2 - y1 < PAGE_MIN.h) {
		if (handle.includes("n")) y1 = y2 - PAGE_MIN.h;
		else y2 = y1 + PAGE_MIN.h;
	}
	return { box: { x: Math.round(x1), y: Math.round(y1), w: Math.round(x2 - x1), h: Math.round(y2 - y1) }, guides: moved.guides };
}

/**
 * A board that reads top to bottom, as its resize shows it: the height the drag gives it is the floor
 * written to the file, and the board is drawn no shorter than its content (`least`), as it will be
 * once that floor is written. Its top is where the drag has it, by whichever handle: a document
 * dragged shorter by its top moves down and still holds all of its words.
 */
export function shownPageResize(box: Rect, least: number | undefined): Rect {
	return least && box.h < least ? { ...box, h: least } : box;
}

/** What a board's resize changed, on the lift: where it moved to, if a left or top edge was dragged, and its new size. */
export function pageResizeEnd(start: Rect, next: Rect): { move?: Pt; size?: { w: number; h: number } } {
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

/** A card's least width: 48, the least height a card hugs its words at and the height one is made at, so at its smallest it is square. */
export const CARD_MIN_W = 48;

/** The least width a resize leaves: `CARD_MIN_W` for a card or a note, 4 for anything else. */
export function sizeNarrowest(node: PenNode | undefined): number {
	return node && (isMarkdown(node) || isCard(node)) ? CARD_MIN_W : 4;
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
