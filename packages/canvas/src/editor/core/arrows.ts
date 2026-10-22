/**
 * Editing an arrow: what its ends join, the side they keep to, a join slid along its side, its
 * middle pulled, and the ops that letting go writes. Each move of the pointer is one call here,
 * with the camera's zoom passed in (reaches are in screen pixels); the pointer loops are the page's.
 *
 * The routes are `@decks/pen`'s (`arrowPoints`), as the drawing's are: a handle's dashed draft is
 * the line the arrow will be drawn on once the op lands.
 */
import { ARROW_SIDES, arrowBend, arrowEndAt, arrowEndItem, arrowEndSide, arrowMiddle, arrowPoints, arrowShape, arrowStyle, isArrow, sidePoint, type ArrowRoute, type ArrowSide, type Op, type PenNode } from "@decks/pen";
import type { Pt, Rect } from "./model.ts";
import { pickAt } from "./pick.ts";
import type { SceneQuery } from "./scene.ts";

/** An end let go within this many screen pixels of a side's middle keeps to that side (or a quarter of a small box). */
export const SIDE_PX = 14;
/** Within this many screen pixels of the side it joins, an end's drag slides the join; further, it re-attaches. */
export const SLIDE_PX = 18;
/** A slid join clicks to a corner or the middle within this many screen pixels, unless Alt is held. */
export const JOIN_SNAP_PX = 8;

export type Which = "from" | "to";
/** What an end would join at a point: an item or a board, its box to light up, and the side it is near. */
export type Join = { name: string; box: Rect; side?: ArrowSide };
/** An end as the arrow's metadata writes it: an item, an item and a side (and where along it), or a point. */
export type ArrowEnd = string | { item: string; side: ArrowSide; at?: number } | [number, number];
/** What a joined end of the selected arrow joins, for its drag to slide along (`slideJoin`). */
export type JoinedEnd = { item: string; box: Rect; side: ArrowSide; at?: number };
/** The handles of a selected arrow: its two ends, what they join, and its middle when it has one to pull. */
export type ArrowHandles = { id: string; route: ArrowRoute; from: Pt; to: Pt; fromJoin?: JoinedEnd; toJoin?: JoinedEnd; middle?: Pt; bent: boolean };
/** A route drawn dashed while a handle is dragged: the path's geometry and where it sits. */
export type RouteDraft = { d: string; x: number; y: number };

type Metadata = Record<string, unknown>;

const copy = (box: Rect): Rect => ({ x: box.x, y: box.y, w: box.w, h: box.h });

/** The board under a stage point, the last on top: an arrow may start or end on it. */
export function boardAt(scene: SceneQuery, point: Pt): string | undefined {
	return scene.boards().findLast((b) => point.x >= b.x && point.x <= b.x + b.w && point.y >= b.y && point.y <= b.y + b.h)?.path;
}

/** Where an end's item or board is placed: an item's box first, then a board's. */
export function endBox(scene: SceneQuery, name: string): Rect | undefined {
	const box = scene.item(name)?.box;
	if (box) return box;
	const board = scene.boards().find((one) => one.path === name);
	return board ? copy(board) : undefined;
}

/** The line an arrow's metadata describes through where its ends are now (`@decks/pen`'s router). */
export function arrowLine(scene: SceneQuery, metadata: unknown): Array<[number, number]> | undefined {
	return arrowPoints(metadata, new Map(), (name) => endBox(scene, name));
}

/**
 * The side of a box whose middle a point is close to, if any: an end let go there keeps to that
 * side (`sidedRoute`). Close is `SIDE_PX` on screen, or a quarter of a small box, but never under 6.
 */
export function sideNear(box: Rect, point: Pt, zoom: number): ArrowSide | undefined {
	const reach = Math.min(SIDE_PX / zoom, Math.max(6 / zoom, Math.min(box.w, box.h) / 4));
	let best: { side: ArrowSide; d: number } | undefined;
	for (const side of ARROW_SIDES) {
		const [x, y] = sidePoint(box, side);
		const d = Math.hypot(point.x - x, point.y - y);
		if (d <= reach && (!best || d < best.d)) best = { side, d };
	}
	return best?.side;
}

/** The side of a box a point on its edge lies on: the nearest, top before bottom before left before right on a tie. */
export function onSide(box: Rect, point: Pt): ArrowSide {
	const d: Array<[ArrowSide, number]> = [["top", Math.abs(point.y - box.y)], ["bottom", Math.abs(point.y - (box.y + box.h))], ["left", Math.abs(point.x - box.x)], ["right", Math.abs(point.x - (box.x + box.w))]];
	return d.sort((a, b) => a[1] - b[1])[0]![0];
}

/**
 * What an arrow's end joins at a point: the item a press picks there, or else the board, with the
 * side it is near. Never an arrow (one line does not join another) and never `not`, the arrow
 * whose end it is.
 */
export function joinAt(scene: SceneQuery, point: Pt, options: { zoom: number; not?: string }): Join | undefined {
	// An end joins the outermost group round what it is let go on, as it always has.
	const hit = pickAt(scene, point, { policy: "outermost", skip: (node) => isArrow(node) || node.id === options.not });
	const found = hit
		? { name: hit.id, box: hit.box }
		: (() => {
				const path = boardAt(scene, point);
				const board = path ? scene.boards().find((candidate) => candidate.path === path) : undefined;
				return board ? { name: board.path, box: copy(board) } : undefined;
			})();
	if (!found) return undefined;
	const side = sideNear(found.box, point, options.zoom);
	return side ? { ...found, side } : found;
}

/** How a join is written as an arrow's end: an item, or an item and the side it keeps to. */
export const endOf = (join: { name: string; side?: ArrowSide }): ArrowEnd => (join.side ? { item: join.name, side: join.side } : join.name);
/** A point end, to a tenth of a pixel. */
export const pointEnd = (point: Pt): [number, number] => [Math.round(point.x * 10) / 10, Math.round(point.y * 10) / 10];

/**
 * The handles of an arrow as drawn, moved by `drag` (the selection's carried offset). Undefined for
 * anything that is not an arrow, or an arrow an end of which cannot be found. A joined end's side
 * is the one it names, or else the side its point is on. The middle handle is there when an elbow
 * has a middle segment to slide, and always on a line or a curve.
 */
export function arrowHandles(scene: SceneQuery, id: string, drag: { dx: number; dy: number } = { dx: 0, dy: 0 }): ArrowHandles | undefined {
	const placed = scene.item(id);
	const node = placed?.node;
	if (!node || !isArrow(node)) return undefined;
	// On the line as it is drawn, so a handle sits on the arrow the person sees; the route its metadata
	// would take now only for an arrow not drawn yet (the two part when what it joins moved since).
	const points = drawnLine(node, placed.box) ?? arrowLine(scene, node.metadata);
	if (!points) return undefined;
	const [fx, fy] = points[0]!;
	const [tx, ty] = points[points.length - 1]!;
	const route = arrowStyle(node.metadata).route;
	const [mx, my] = arrowMiddle(points, route);
	const joined = (end: unknown, x: number, y: number): JoinedEnd | undefined => {
		const item = arrowEndItem(end);
		const box = item ? endBox(scene, item) : undefined;
		if (!item || !box) return undefined;
		const side = arrowEndSide(end) ?? onSide(box, { x, y });
		return { item, box: copy(box), side, at: arrowEndAt(end) };
	};
	const bendable = route !== "elbow" || points.length === 4;
	const meta = node.metadata as { from?: unknown; to?: unknown };
	return {
		id: node.id,
		route,
		from: { x: fx + drag.dx, y: fy + drag.dy },
		to: { x: tx + drag.dx, y: ty + drag.dy },
		fromJoin: joined(meta.from, fx, fy),
		toJoin: joined(meta.to, tx, ty),
		...(bendable ? { middle: { x: mx + drag.dx, y: my + drag.dy } } : {}),
		bent: arrowBend(node.metadata) !== undefined,
	};
}

/**
 * An arrow's line as it is drawn, on the stage: the points of its geometry's first subpath (a curve's
 * start, two controls and end; a line's corners), through its box and `viewBox`. Undefined when it has
 * no geometry or the subpath is neither.
 */
export function drawnLine(node: PenNode, box: Rect): Array<[number, number]> | undefined {
	if (typeof node.geometry !== "string") return undefined;
	const line = node.geometry.trim().split(/(?=M)/i)[0] ?? "";
	if (!/^M/i.test(line) || /[^MLC\d\s.,eE+-]/i.test(line)) return undefined;
	const n = (line.match(/-?\d*\.?\d+(?:e[+-]?\d+)?/gi) ?? []).map(Number);
	if (n.length < 4 || n.length % 2) return undefined;
	const vb = Array.isArray(node.viewBox) && node.viewBox.length === 4 ? (node.viewBox as number[]) : [0, 0, box.w, box.h];
	const sx = vb[2] ? box.w / vb[2]! : 1;
	const sy = vb[3] ? box.h / vb[3]! : 1;
	const points: Array<[number, number]> = [];
	for (let i = 0; i < n.length; i += 2) points.push([box.x + (n[i]! - vb[0]!) * sx, box.y + (n[i + 1]! - vb[1]!) * sy]);
	return points;
}

/** The route an arrow would take with this metadata, as a dashed draft: what a handle's drag shows. */
export function routeDraft(scene: SceneQuery, metadata: Metadata, node: PenNode): RouteDraft | undefined {
	const points = arrowLine(scene, metadata);
	if (!points) return undefined;
	const shape = arrowShape(points, typeof node.strokeWidth === "number" ? node.strokeWidth : 2, arrowStyle(metadata));
	return { d: shape.geometry, x: shape.x, y: shape.y };
}

/**
 * Where along a side a point slides a join: 0 at its top or left end, 1 at the other, to a
 * thousandth. It clicks to the ends and the middle within `JOIN_SNAP_PX` on screen, unless `free`.
 */
export function slideAt(box: Rect, side: ArrowSide, point: Pt, options: { zoom: number; free?: boolean }): number {
	const along = side === "top" || side === "bottom";
	const length = along ? box.w : box.h;
	// A side of no length has one place on it: its middle.
	if (!(length > 0)) return 0.5;
	let at = (along ? point.x - box.x : point.y - box.y) / length;
	at = Math.max(0, Math.min(1, at));
	if (!options.free) for (const stop of [0, 0.5, 1]) if (Math.abs(at - stop) * length * options.zoom <= JOIN_SNAP_PX) at = stop;
	return Math.round(at * 1000) / 1000;
}

/** Whether a point is within `SLIDE_PX` on screen of a box's side, along its length (and that far past its ends). */
export function nearSide(box: Rect, side: ArrowSide, point: Pt, zoom: number): boolean {
	const reach = SLIDE_PX / zoom;
	const along = side === "top" || side === "bottom";
	const line = side === "top" ? box.y : side === "bottom" ? box.y + box.h : side === "left" ? box.x : box.x + box.w;
	const off = Math.abs((along ? point.y : point.x) - line);
	const within = along ? point.x >= box.x - reach && point.x <= box.x + box.w + reach : point.y >= box.y - reach && point.y <= box.y + box.h + reach;
	return off <= reach && within;
}

/** One move of a joined end's drag near its side: the join slid there; undefined once it is away from the side. */
export function slideJoin(own: JoinedEnd | undefined, point: Pt, options: { zoom: number; free?: boolean }): { item: string; side: ArrowSide; at: number } | undefined {
	return own && nearSide(own.box, own.side, point, options.zoom) ? { item: own.item, side: own.side, at: slideAt(own.box, own.side, point, options) } : undefined;
}

/** An arrow's metadata with one end set. */
export const withEnd = (metadata: Metadata, which: Which, end: unknown): Metadata => ({ ...metadata, [which]: end });

/** The op that writes an arrow's metadata. */
export const arrowOp = (id: string, metadata: Metadata): Op => ({ op: "update", id, set: { metadata } });

/**
 * An end let go at a point, away from its side: it joins what is there, or is a point on bare
 * canvas. An arrow from a thing to itself is a point on it instead.
 */
export function droppedEnd(scene: SceneQuery, id: string, metadata: Metadata, which: Which, point: Pt, zoom: number): ArrowEnd {
	const other = arrowEndItem(metadata[which === "from" ? "to" : "from"]);
	const join = joinAt(scene, point, { zoom, not: id });
	return join && join.name !== other ? endOf(join) : pointEnd(point);
}

/** A double-click on a joined end: the join goes back to the middle of its side. Undefined when it has no `at`. */
export function resetEndOp(id: string, metadata: Metadata | undefined, which: Which): Op | undefined {
	const end = metadata?.[which];
	if (!metadata || !end || typeof end !== "object" || Array.isArray(end) || !("at" in end)) return undefined;
	const { at: _at, ...kept } = end as Record<string, unknown>;
	return arrowOp(id, withEnd(metadata, which, kept));
}

/** The start of a middle handle's drag: the metadata with no bend, and the automatic route it gives. */
export function bendStart(scene: SceneQuery, metadata: Metadata): { unbent: Metadata; auto: Array<[number, number]> } | undefined {
	const { bend: _was, ...unbent } = metadata;
	const auto = arrowLine(scene, unbent);
	return auto ? { unbent, auto } : undefined;
}

/**
 * One move of the middle handle: an elbow's middle segment slides along its run (`bend`, 0 to 1 from
 * start to end, to a thousandth); a curve's middle is pulled (`bend: [dx, dy]`, whole pixels from
 * the automatic middle), and a straight line pulled there becomes a curve.
 */
export function bendAt(start: { unbent: Metadata; auto: Array<[number, number]> }, route: ArrowRoute, now: Pt): Metadata {
	const { unbent, auto } = start;
	if (route === "elbow") {
		const [p, q] = [auto[0]!, auto[auto.length - 1]!];
		// The middle segment runs down when its two points share an x, so it slides across.
		const across = auto.length === 4 && auto[1]![0] === auto[2]![0];
		const span = across ? q[0] - p[0] : q[1] - p[1];
		const turn = span === 0 ? 0.5 : (across ? now.x - p[0] : now.y - p[1]) / span;
		return { ...unbent, bend: Math.round(Math.max(0, Math.min(1, turn)) * 1000) / 1000 };
	}
	const [mx, my] = arrowMiddle(route === "curved" ? auto : [auto[0]!, auto[auto.length - 1]!], route === "curved" ? "curved" : "straight");
	return { ...unbent, route: "curved", bend: [Math.round(now.x - mx), Math.round(now.y - my)] };
}

/** A double-click on the middle handle: back on the automatic route. Undefined when it is not bent. */
export function resetBendOp(id: string, metadata: Metadata | undefined): Op | undefined {
	if (!metadata || !("bend" in metadata)) return undefined;
	const { bend: _bend, ...kept } = metadata;
	return arrowOp(id, kept);
}

/**
 * The ends of a new arrow drawn from `at` to `end`: each joins what it was pressed or let go on, or
 * is a point there. Undefined for a click with no drag unless it joins two different things.
 */
export function newArrowEnds(fromJoin: Join | undefined, toJoin: Join | undefined, at: Pt, end: Pt, moved: boolean): { from: ArrowEnd; to: ArrowEnd } | undefined {
	if (!moved && (!fromJoin || !toJoin || fromJoin.name === toJoin.name)) return undefined;
	return { from: fromJoin ? endOf(fromJoin) : pointEnd(at), to: toJoin && toJoin.name !== fromJoin?.name ? endOf(toJoin) : pointEnd(end) };
}
