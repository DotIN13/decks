import { indexOf, walk } from "./doc.ts";
import type { Frame, Placed } from "./layout.ts";
import type { PenDocument, PenNode } from "./types.ts";

/**
 * Arrows that stay joined to what they join.
 *
 * pen has no arrow type, so an arrow is pen's own `path` — a line and its head in `geometry` —
 * which pen.dev draws as it is. What pen.dev does not know is which two things the arrow joins,
 * so that rides in pen's extension field:
 *
 *     { "type": "path", "id": "then", "metadata": { "type": "decks.arrow", "from": "draft", "to": "boards/report.html" } }
 *
 * `from` and `to` name an item by id, a board by its path, or a point on the stage as `[x, y]` —
 * the end of an arrow that stops on bare canvas. After an edit, `reroute` redraws every such path
 * between the nearest edges of its two ends: the box, the viewBox and the geometry are rewritten,
 * and the stroke is left as the writer set it. An arrow whose end cannot be found is left alone.
 *
 * Its style is three more fields there, all optional: `route` is `"straight"` (the default),
 * `"curved"` or `"elbow"`; `heads` is `"end"` (the default), `"both"` or `"none"`; and `dash: true`
 * draws the line dashed, which pen.dev, knowing nothing of it, draws solid.
 *
 * A point end is where it is on the stage, not in the arrow's own box, so moving an arrow by its
 * `x` and `y` alone is undone by the next reroute: `moveArrowEnds` shifts its points with it.
 */

export const ARROW = "decks.arrow";

/** The head's length and half-width, per unit of stroke width, with a floor for thin lines. */
const HEAD = 5;

export function isArrow(node: PenNode): boolean {
	return node.type === "path" && !!node.metadata && node.metadata.type === ARROW;
}

/**
 * Redraw every arrow in `doc` from where its ends are now. Returns whether anything changed.
 *
 * `placed` is the layout of the document; `extra` finds anything that is not an item — a board,
 * by its path.
 */
export function reroute(doc: PenDocument, placed: ReadonlyMap<string, Placed>, extra?: (name: string) => Frame | undefined): boolean {
	const index = indexOf(doc);
	let changed = false;
	for (const node of walk(doc.children)) {
		if (!isArrow(node)) continue;
		const meta = node.metadata as { from?: unknown; to?: unknown };
		const from = arrowEnd(meta.from, placed, extra);
		const to = arrowEnd(meta.to, placed, extra);
		if (!from || !to) continue;
		const stroke = typeof node.strokeWidth === "number" ? node.strokeWidth : 2;
		const style = arrowStyle(node.metadata);
		const shape = arrowShape(arrowRoute(from, to, style.route), stroke, style);
		const parent = index.get(node.id)?.parent;
		const origin = parent ? placed.get(parent.id)?.box : undefined;
		const next = { ...shape, x: round(shape.x - (origin?.x ?? 0)), y: round(shape.y - (origin?.y ?? 0)) };
		if (node.geometry === next.geometry && node.x === next.x && node.y === next.y) continue;
		Object.assign(node, next);
		if (node.stroke === undefined) node.stroke = "#8a8f98";
		if (node.strokeWidth === undefined) node.strokeWidth = 2;
		if (node.strokeLinecap === undefined) node.strokeLinecap = "round";
		if (node.strokeLinejoin === undefined) node.strokeLinejoin = "round";
		// An arrow sits where its ends are, never where a row layout would put it.
		if (parent && parent.type === "frame" && (parent.layout ?? "horizontal") !== "none") node.layoutPosition = "absolute";
		changed = true;
	}
	return changed;
}

type Point = [number, number];

export type ArrowRoute = "straight" | "curved" | "elbow";
export type ArrowHeads = "end" | "both" | "none";
export interface ArrowStyle {
	route: ArrowRoute;
	heads: ArrowHeads;
	dash: boolean;
}

/** An arrow's style from its metadata, with the defaults for what it does not say. */
export function arrowStyle(metadata: unknown): ArrowStyle {
	const meta = (metadata ?? {}) as { route?: unknown; heads?: unknown; dash?: unknown };
	const route: ArrowRoute = meta.route === "curved" || meta.route === "elbow" ? meta.route : "straight";
	const heads: ArrowHeads = meta.heads === "both" || meta.heads === "none" ? meta.heads : "end";
	return { route, heads, dash: meta.dash === true };
}

/** A point end, `[x, y]` on the stage. */
export function isPointEnd(end: unknown): end is Point {
	return Array.isArray(end) && end.length === 2 && typeof end[0] === "number" && typeof end[1] === "number";
}

/** Where an arrow's end is: an item's box, a board's (through `extra`), or a point as a box of no size. */
export function arrowEnd(end: unknown, placed: ReadonlyMap<string, Placed>, extra?: (name: string) => Frame | undefined): Frame | undefined {
	if (isPointEnd(end)) return { x: end[0], y: end[1], w: 0, h: 0 };
	return typeof end === "string" ? (placed.get(end)?.box ?? extra?.(end)) : undefined;
}

/** An arrow's metadata with its point ends moved by `dx dy`; joined ends stay joined. */
export function moveArrowEnds(metadata: Record<string, unknown>, dx: number, dy: number): Record<string, unknown> {
	const shift = (end: unknown) => (isPointEnd(end) ? [round(end[0] + dx), round(end[1] + dy)] : end);
	return { ...metadata, from: shift(metadata.from), to: shift(metadata.to) };
}

/**
 * A line through `points` with its heads, as the fields of a pen `path`: its corner on the stage,
 * its size, its `viewBox` and its `geometry`. What `reroute` writes for a joined arrow, and what a
 * free arrow drawn by hand is made of. A curved route's four points are a cubic Bézier's start,
 * two controls and end. The line is the geometry's first subpath and each head one after it, so a
 * dash can be put on the line alone.
 */
export function arrowShape(points: Point[], strokeWidth = 2, style: Partial<ArrowStyle> = {}): { x: number; y: number; width: number; height: number; viewBox: [number, number, number, number]; geometry: string } {
	const head = Math.max(8, strokeWidth * HEAD);
	const heads = style.heads ?? "end";
	const curved = style.route === "curved" && points.length === 4;
	const arms: Array<[Point, Point, Point]> = [
		...(heads !== "none" ? [headPoints(points, head)] : []),
		...(heads === "both" ? [headPoints([...points].reverse(), head)] : []),
	];
	const all = [...points, ...arms.flat()];
	const pad = strokeWidth;
	const minX = Math.min(...all.map((p) => p[0])) - pad;
	const minY = Math.min(...all.map((p) => p[1])) - pad;
	const maxX = Math.max(...all.map((p) => p[0])) + pad;
	const maxY = Math.max(...all.map((p) => p[1])) + pad;
	const local = (p: Point) => `${round(p[0] - minX)} ${round(p[1] - minY)}`;
	const line = curved ? `M${local(points[0]!)} C${local(points[1]!)} ${local(points[2]!)} ${local(points[3]!)}` : `M${points.map(local).join(" L")}`;
	return {
		x: round(minX),
		y: round(minY),
		width: round(maxX - minX),
		height: round(maxY - minY),
		viewBox: [0, 0, round(maxX - minX), round(maxY - minY)],
		geometry: [line, ...arms.map(([a, b, c]) => `M${local(a)} L${local(b)} L${local(c)}`)].join(" "),
	};
}

/**
 * From the edge of `a` that faces `b`, to the edge of `b` that faces `a`: the line's points, first
 * to last. A curve leaves and arrives square to those edges, so its points are its start, two
 * controls out from each edge by half the distance between them, and its end. `true` is the elbow
 * route and `false` the straight one, as this took before routes had names.
 */
export function arrowRoute(a: Frame, b: Frame, route: ArrowRoute | boolean): Point[] {
	const kind: ArrowRoute = route === true ? "elbow" : route === false ? "straight" : route;
	const elbow = kind === "elbow";
	const curve = (start: Point, end: Point, across: boolean): Point[] => {
		const reach = Math.max(24, (across ? Math.abs(end[0] - start[0]) : Math.abs(end[1] - start[1])) / 2);
		const sign = across ? Math.sign(end[0] - start[0]) || 1 : Math.sign(end[1] - start[1]) || 1;
		const c1: Point = across ? [start[0] + sign * reach, start[1]] : [start[0], start[1] + sign * reach];
		const c2: Point = across ? [end[0] - sign * reach, end[1]] : [end[0], end[1] - sign * reach];
		return [start, c1, c2, end];
	};
	const ac: Point = [a.x + a.w / 2, a.y + a.h / 2];
	const bc: Point = [b.x + b.w / 2, b.y + b.h / 2];
	const dx = bc[0] - ac[0];
	const dy = bc[1] - ac[1];
	// Side by side when the gap across is wider than the gap down, and the other way round.
	const gapX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
	const gapY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
	// Where the two overlap across the line's direction, it runs straight through the middle of the overlap.
	const shared = (a0: number, a1: number, b0: number, b1: number): number | undefined => {
		const lo = Math.max(a0, b0);
		const hi = Math.min(a1, b1);
		return hi > lo ? (lo + hi) / 2 : undefined;
	};
	if (gapX >= gapY) {
		const level = shared(a.y, a.y + a.h, b.y, b.y + b.h);
		const start: Point = [dx >= 0 ? a.x + a.w : a.x, level ?? ac[1]];
		const end: Point = [dx >= 0 ? b.x : b.x + b.w, level ?? bc[1]];
		if (kind === "curved" && start[1] !== end[1]) return curve(start, end, true);
		if (!elbow || start[1] === end[1]) return [start, end];
		const mid = (start[0] + end[0]) / 2;
		return [start, [mid, start[1]], [mid, end[1]], end];
	}
	const column = shared(a.x, a.x + a.w, b.x, b.x + b.w);
	const start: Point = [column ?? ac[0], dy >= 0 ? a.y + a.h : a.y];
	const end: Point = [column ?? bc[0], dy >= 0 ? b.y : b.y + b.h];
	if (kind === "curved" && start[0] !== end[0]) return curve(start, end, false);
	if (!elbow || start[0] === end[0]) return [start, end];
	const mid = (start[1] + end[1]) / 2;
	return [start, [start[0], mid], [end[0], mid], end];
}

/** The chevron at the end of the last segment: one arm, the tip, the other arm. */
function headPoints(points: Point[], head: number): [Point, Point, Point] {
	const tip = points[points.length - 1]!;
	const from = points[points.length - 2]!;
	const len = Math.hypot(tip[0] - from[0], tip[1] - from[1]) || 1;
	const ux = (tip[0] - from[0]) / len;
	const uy = (tip[1] - from[1]) / len;
	const back: Point = [tip[0] - ux * head, tip[1] - uy * head];
	const half = head * 0.6;
	return [
		[back[0] - uy * half, back[1] + ux * half],
		tip,
		[back[0] + uy * half, back[1] - ux * half],
	];
}

const round = (n: number) => Math.round(n * 10) / 10;
