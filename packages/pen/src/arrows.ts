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
 * `from` and `to` name an item by id, or a board by its path. After an edit, `reroute` redraws
 * every such path between the nearest edges of its two ends: the box, the viewBox and the
 * geometry are rewritten, and the stroke is left as the writer set it. `route: "elbow"` draws a
 * right-angled line instead of a straight one. An arrow whose end cannot be found is left alone.
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
		const meta = node.metadata as { from?: unknown; to?: unknown; route?: unknown };
		const end = (name: unknown) => (typeof name === "string" ? (placed.get(name)?.box ?? extra?.(name)) : undefined);
		const from = end(meta.from);
		const to = end(meta.to);
		if (!from || !to) continue;
		const stroke = typeof node.strokeWidth === "number" ? node.strokeWidth : 2;
		const head = Math.max(8, stroke * HEAD);
		const points = route(from, to, meta.route === "elbow");
		const all = [...points, ...headPoints(points, head)];
		const pad = stroke;
		const minX = Math.min(...all.map((p) => p[0])) - pad;
		const minY = Math.min(...all.map((p) => p[1])) - pad;
		const maxX = Math.max(...all.map((p) => p[0])) + pad;
		const maxY = Math.max(...all.map((p) => p[1])) + pad;
		const local = (p: [number, number]) => `${round(p[0] - minX)} ${round(p[1] - minY)}`;
		const [a, b, c] = headPoints(points, head);
		const geometry = `M${points.map(local).join(" L")} M${local(a!)} L${local(b!)} L${local(c!)}`;
		const parent = index.get(node.id)?.parent;
		const origin = parent ? placed.get(parent.id)?.box : undefined;
		const next = {
			x: round(minX - (origin?.x ?? 0)),
			y: round(minY - (origin?.y ?? 0)),
			width: round(maxX - minX),
			height: round(maxY - minY),
			viewBox: [0, 0, round(maxX - minX), round(maxY - minY)] as [number, number, number, number],
			geometry,
		};
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

/** From the edge of `a` that faces `b`, to the edge of `b` that faces `a`. */
function route(a: Frame, b: Frame, elbow: boolean): Point[] {
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
		if (!elbow || start[1] === end[1]) return [start, end];
		const mid = (start[0] + end[0]) / 2;
		return [start, [mid, start[1]], [mid, end[1]], end];
	}
	const column = shared(a.x, a.x + a.w, b.x, b.x + b.w);
	const start: Point = [column ?? ac[0], dy >= 0 ? a.y + a.h : a.y];
	const end: Point = [column ?? bc[0], dy >= 0 ? b.y : b.y + b.h];
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
