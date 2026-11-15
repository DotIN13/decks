/**
 * Snapping, the way a design tool does it: a box being moved lines its edges and its middle up
 * with the edges and middles of what is around it, and settles into the gap its neighbours
 * already keep between themselves. The stage draws a guide wherever it snapped.
 *
 * Pure arithmetic on stage boxes, so it can be tested without a canvas. `threshold` is in stage
 * units, which the caller works out from a number of screen pixels and the zoom.
 */

export interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}

/**
 * A line to draw: an alignment (`kind: "line"`) or one measured gap between two boxes (`"gap"`).
 * An alignment carries the points on it that line up (`points`), each marked with a ✕; a gap that
 * is the reading gap between two boards says its size (`label`).
 */
export interface Guide {
	kind: "line" | "gap";
	x1: number;
	y1: number;
	x2: number;
	y2: number;
	points?: { x: number; y: number }[];
	label?: string;
}

/** The gap a board keeps from the next one, beside it or above or below it, for reading them in order. */
export const READING_GAP = 160;

const lines = (b: Box, axis: "x" | "y") => (axis === "x" ? [b.x, b.x + b.w / 2, b.x + b.w] : [b.y, b.y + b.h / 2, b.y + b.h]);
const start = (b: Box, axis: "x" | "y") => (axis === "x" ? b.x : b.y);
const end = (b: Box, axis: "x" | "y") => (axis === "x" ? b.x + b.w : b.y + b.h);
const size = (b: Box, axis: "x" | "y") => (axis === "x" ? b.w : b.h);
const cross = (axis: "x" | "y"): "x" | "y" => (axis === "x" ? "y" : "x");
/** Whether two boxes share some of the other axis: side by side for `x`, one above the other for `y`. */
const overlaps = (a: Box, b: Box, axis: "x" | "y") => start(a, cross(axis)) < end(b, cross(axis)) && start(b, cross(axis)) < end(a, cross(axis));
const EPS = 0.5;

/** The smallest correction along one axis that lines `moving` up with a target or an equal gap. */
function bestShift(moving: Box, targets: readonly Box[], axis: "x" | "y", threshold: number, reading: readonly Box[] = []): number | undefined {
	let best: number | undefined;
	const offer = (shift: number) => {
		if (Math.abs(shift) <= threshold && (best === undefined || Math.abs(shift) < Math.abs(best))) best = shift;
	};
	// The reading gap: a board settles `READING_GAP` beside, above or below another.
	for (const board of reading) {
		offer(end(board, axis) + READING_GAP - start(moving, axis));
		offer(start(board, axis) - READING_GAP - end(moving, axis));
	}
	const mine = lines(moving, axis);
	for (const target of targets) for (const t of lines(target, axis)) for (const m of mine) offer(t - m);
	// Equal gaps: beside a pair keeping a gap, or centred between two.
	const row = targets.filter((t) => overlaps(t, moving, axis));
	for (const a of row) {
		for (const b of row) {
			if (a === b || end(a, axis) > start(b, axis)) continue;
			const gap = start(b, axis) - end(a, axis);
			offer(end(b, axis) + gap - start(moving, axis));
			offer(start(a, axis) - gap - end(moving, axis));
			const room = start(b, axis) - end(a, axis) - size(moving, axis);
			if (room >= 0) offer(end(a, axis) + room / 2 - start(moving, axis));
		}
	}
	return best;
}

/** The guides that hold for a box already in place: every line it shares and every gap it repeats. */
function guidesFor(moving: Box, targets: readonly Box[], axis: "x" | "y"): Guide[] {
	const out: Guide[] = [];
	const other = cross(axis);
	for (const m of lines(moving, axis)) {
		const hits = targets.filter((t) => lines(t, axis).some((v) => Math.abs(v - m) < EPS));
		if (hits.length === 0) continue;
		const lo = Math.min(start(moving, other), ...hits.map((t) => start(t, other)));
		const hi = Math.max(end(moving, other), ...hits.map((t) => end(t, other)));
		out.push(axis === "x" ? { kind: "line", x1: m, y1: lo, x2: m, y2: hi, points: pointsOn(m, [moving, ...hits], axis) } : { kind: "line", x1: lo, y1: m, x2: hi, y2: m, points: pointsOn(m, [moving, ...hits], axis) });
	}
	const row = targets.filter((t) => overlaps(t, moving, axis));
	const gapLine = (from: number, to: number, a: Box, b: Box): Guide => {
		const mid = (Math.max(start(a, other), start(b, other)) + Math.min(end(a, other), end(b, other))) / 2;
		return axis === "x" ? { kind: "gap", x1: from, y1: mid, x2: to, y2: mid } : { kind: "gap", x1: mid, y1: from, x2: mid, y2: to };
	};
	const before = row.filter((t) => end(t, axis) <= start(moving, axis) + EPS).sort((p, q) => end(q, axis) - end(p, axis))[0];
	const after = row.filter((t) => start(t, axis) >= end(moving, axis) - EPS).sort((p, q) => start(p, axis) - start(q, axis))[0];
	const gapBefore = before ? start(moving, axis) - end(before, axis) : undefined;
	const gapAfter = after ? start(after, axis) - end(moving, axis) : undefined;
	// Centred between two neighbours.
	if (before && after && gapBefore !== undefined && gapAfter !== undefined && gapBefore > EPS && Math.abs(gapBefore - gapAfter) < EPS) {
		out.push(gapLine(end(before, axis), start(moving, axis), before, moving), gapLine(end(moving, axis), start(after, axis), moving, after));
		return out;
	}
	// Repeating a gap two others keep: the pair's gap and the new one.
	for (const [near, gap, side] of [[before, gapBefore, -1], [after, gapAfter, 1]] as const) {
		if (!near || gap === undefined || gap <= EPS) continue;
		const far = row.find((t) => t !== near && (side < 0 ? Math.abs(start(near, axis) - end(t, axis) - gap) < EPS : Math.abs(start(t, axis) - end(near, axis) - gap) < EPS));
		if (!far) continue;
		if (side < 0) out.push(gapLine(end(far, axis), start(near, axis), far, near), gapLine(end(near, axis), start(moving, axis), near, moving));
		else out.push(gapLine(end(moving, axis), start(near, axis), moving, near), gapLine(end(near, axis), start(far, axis), near, far));
	}
	return out;
}

/**
 * The points on an alignment at `at` that line up: each box's edges and middle along the line,
 * where the box has an edge or its middle on it. Each is marked with a ✕.
 */
function pointsOn(at: number, boxes: readonly Box[], axis: "x" | "y"): { x: number; y: number }[] {
	const other = cross(axis);
	const out: { x: number; y: number }[] = [];
	const seen = new Set<string>();
	for (const box of boxes) {
		if (!lines(box, axis).some((v) => Math.abs(v - at) < EPS)) continue;
		for (const v of lines(box, other)) {
			const point = axis === "x" ? { x: at, y: v } : { x: v, y: at };
			const key = `${Math.round(point.x * 100)},${Math.round(point.y * 100)}`;
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(point);
		}
	}
	return out;
}

/**
 * The reading gaps a board in place keeps: `READING_GAP` from another board beside it, above it or
 * below it, drawn across the gap with its size. Level with the middle of what the two share, or
 * with the moving board's middle when they share nothing.
 */
function readingGuides(moving: Box, boards: readonly Box[]): Guide[] {
	const out: Guide[] = [];
	for (const board of boards) {
		for (const axis of ["x", "y"] as const) {
			const other = cross(axis);
			const after = Math.abs(start(moving, axis) - end(board, axis) - READING_GAP) < EPS;
			const before = Math.abs(start(board, axis) - end(moving, axis) - READING_GAP) < EPS;
			if (!after && !before) continue;
			const [from, to] = after ? [end(board, axis), start(moving, axis)] : [end(moving, axis), start(board, axis)];
			const shared = overlaps(moving, board, axis);
			const mid = shared ? (Math.max(start(moving, other), start(board, other)) + Math.min(end(moving, other), end(board, other))) / 2 : start(moving, other) + size(moving, other) / 2;
			out.push(axis === "x" ? { kind: "gap", x1: from, y1: mid, x2: to, y2: mid, label: String(READING_GAP) } : { kind: "gap", x1: mid, y1: from, x2: mid, y2: to, label: String(READING_GAP) });
		}
	}
	return out;
}

/**
 * Snap a moved box: the correction to add to the move, and the guides to draw where it lands.
 * `reading` are boards the box keeps the reading gap from (a board being dragged: the other boards).
 */
export function snapMove(moving: Box, targets: readonly Box[], threshold: number, reading: readonly Box[] = []): { dx: number; dy: number; guides: Guide[] } {
	const dx = bestShift(moving, targets, "x", threshold, reading) ?? 0;
	const dy = bestShift(moving, targets, "y", threshold, reading) ?? 0;
	const placed = { ...moving, x: moving.x + dx, y: moving.y + dy };
	return { dx, dy, guides: [...guidesFor(placed, targets, "x"), ...guidesFor(placed, targets, "y"), ...readingGuides(placed, reading)] };
}

/**
 * Snap the edges a resize is moving. `edges` names them — `x1` left, `x2` right, `y1` top,
 * `y2` bottom — and each is pulled to the nearest line of a target on its own. Returns the box
 * with the edges moved, and a guide for every edge that snapped.
 */
export function snapEdges(box: { x1: number; y1: number; x2: number; y2: number }, edges: ReadonlyArray<"x1" | "x2" | "y1" | "y2">, targets: readonly Box[], threshold: number) {
	const out = { ...box };
	const guides: Guide[] = [];
	for (const edge of edges) {
		const axis = edge[0] as "x" | "y";
		let best: { value: number; target: Box } | undefined;
		for (const target of targets) {
			for (const t of lines(target, axis)) {
				const d = Math.abs(t - out[edge]);
				if (d <= threshold && (!best || d < Math.abs(best.value - out[edge]))) best = { value: t, target };
			}
		}
		if (!best) continue;
		out[edge] = best.value;
		const other = cross(axis);
		const lo = Math.min(other === "x" ? Math.min(out.x1, out.x2) : Math.min(out.y1, out.y2), start(best.target, other));
		const hi = Math.max(other === "x" ? Math.max(out.x1, out.x2) : Math.max(out.y1, out.y2), end(best.target, other));
		const edged = { x: Math.min(out.x1, out.x2), y: Math.min(out.y1, out.y2), w: Math.abs(out.x2 - out.x1), h: Math.abs(out.y2 - out.y1) };
		const points = pointsOn(best.value, [edged, best.target], axis);
		guides.push(axis === "x" ? { kind: "line", x1: best.value, y1: lo, x2: best.value, y2: hi, points } : { kind: "line", x1: lo, y1: best.value, x2: hi, y2: best.value, points });
	}
	return { box: out, guides };
}
