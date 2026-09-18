/**
 * Ink: what a person draws on a board with a pen, a finger or a mouse.
 *
 * **It lives in the board's own file**, as one `<svg data-ink-layer>` at the end of the body
 * with a `<path>` per stroke. So a drawing is part of the document: an agent reading the
 * board reads the strokes, a revision holds them, and the board draws them on its own, with
 * no app around it.
 *
 * Each path says the same stroke twice, on purpose. `d` is what a browser draws. `data-points`
 * is what was drawn: `x,y,pressure` triples in board pixels, which is what the eraser, the
 * lasso and a later move are computed from. Deriving the second from the first is not
 * possible once a pen's pressure has been turned into an outline.
 *
 * This module is shared: the browser draws with it and the server writes the file with it,
 * so the markup a frame shows while a stroke is being saved is the markup that lands.
 */

/** The colours on offer. `ink` follows the board's foreground, so it reads in light and dark. */
export const INK_COLORS = ["ink", "red", "blue", "green", "yellow"] as const;
export type InkColor = (typeof INK_COLORS)[number];

export interface InkStroke {
	id: string;
	/** A pen is opaque and takes pressure; a marker is wide, see-through and one width. */
	tool: "pen" | "marker";
	color: InkColor;
	/** The width at a mouse's pressure, in board pixels. */
	size: number;
	/** `x, y, pressure` triples, in board pixels. Pressure is 0 to 1; 0.5 for a mouse or a finger. */
	points: number[];
}

/** The most one board may hold: the whole list crosses the wire on every change. */
export const INK_LIMITS = { strokes: 2000, points: 4000 } as const;

/** The attribute that marks the layer. Not a `data-id`: the layer is not a component to drag. */
export const INK_LAYER = "data-ink-layer";

const PAINT: Record<InkColor, string> = {
	ink: "var(--b-fg, currentColor)",
	red: "#e5484d",
	blue: "#3b82f6",
	green: "#2f9e62",
	yellow: "#f2b200",
};

/** The CSS colour a stroke is drawn in. */
export function inkPaint(color: InkColor): string {
	return PAINT[color];
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Whatever arrived, as strokes that are safe to write into a file.
 *
 * It came off a socket or out of somebody's HTML, so every field is checked: a colour nobody
 * offers, a size that is not a number or points that are not triples drop the stroke, and the
 * list and each stroke are cut at `INK_LIMITS`. Numbers are rounded here, once, so the file
 * and the memory agree.
 */
export function cleanStrokes(raw: unknown): InkStroke[] {
	if (!Array.isArray(raw)) return [];
	const kept: InkStroke[] = [];
	for (const item of raw) {
		if (kept.length >= INK_LIMITS.strokes) break;
		if (!item || typeof item !== "object") continue;
		const { id, tool, color, size, points } = item as Record<string, unknown>;
		if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(id)) continue;
		if (tool !== "pen" && tool !== "marker") continue;
		if (!INK_COLORS.includes(color as InkColor)) continue;
		if (typeof size !== "number" || !Number.isFinite(size) || size <= 0 || size > 200) continue;
		if (!Array.isArray(points) || points.length < 3 || points.length % 3 !== 0) continue;
		if (!points.every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 1e6)) continue;
		const cut = (points as number[]).slice(0, INK_LIMITS.points * 3);
		kept.push({
			id,
			tool,
			color: color as InkColor,
			size: round1(size),
			points: cut.map((n, index) => (index % 3 === 2 ? round2(Math.min(1, Math.max(0, n))) : round1(n))),
		});
	}
	return kept;
}

// --- the file's side: strokes to markup, and back -------------------------------------

/** `x,y,p x,y,p …`: short, readable in a diff, and one attribute. */
export function encodePoints(points: number[]): string {
	const out: string[] = [];
	for (let i = 0; i + 2 < points.length; i += 3) out.push(`${round1(points[i] ?? 0)},${round1(points[i + 1] ?? 0)},${round2(points[i + 2] ?? 0.5)}`);
	return out.join(" ");
}

export function decodePoints(text: string): number[] {
	const out: number[] = [];
	for (const triple of text.trim().split(/\s+/)) {
		const [x, y, p] = triple.split(",").map(Number);
		if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) continue;
		out.push(x, y, p !== undefined && Number.isFinite(p) ? p : 0.5);
	}
	return out;
}

/** One stroke out of a `<path>`'s attributes, or nothing if it is not one. */
export function strokeFromAttributes(get: (name: string) => string | null): InkStroke | undefined {
	const [stroke] = cleanStrokes([
		{
			id: get("data-ink"),
			tool: get("data-tool"),
			color: get("data-color"),
			size: Number(get("data-size")),
			points: decodePoints(get("data-points") ?? ""),
		},
	]);
	return stroke;
}

/** The attributes of one stroke's `<path>`, in the order they are written. */
export function strokeAttributes(stroke: InkStroke): Array<[string, string]> {
	const shape = strokeShape(stroke);
	const paint = inkPaint(stroke.color);
	const drawn: Array<[string, string]> = shape.filled
		? [["fill", paint]]
		: [
				["fill", "none"],
				["stroke", paint],
				["stroke-width", String(stroke.size)],
				["stroke-linecap", "round"],
				["stroke-linejoin", "round"],
			];
	return [
		["data-ink", stroke.id],
		["data-tool", stroke.tool],
		["data-color", stroke.color],
		["data-size", String(stroke.size)],
		...drawn,
		...(stroke.tool === "marker" ? ([["opacity", "0.4"]] as Array<[string, string]>) : []),
		["d", shape.d],
		["data-points", encodePoints(stroke.points)],
	];
}

/** The layer's own attributes: over everything, and never in the way of a click. */
export const INK_LAYER_ATTRIBUTES: Array<[string, string]> = [
	["class", "ink"],
	[INK_LAYER, ""],
	["xmlns", "http://www.w3.org/2000/svg"],
	["style", "position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; z-index: 2147483000"],
];

export const INK_TITLE = "Drawn by hand on this board. One path per stroke; data-points is x,y,pressure in board pixels.";

/** The whole layer as it is written into a board, or `""` when there is nothing drawn. */
export function inkLayerMarkup(strokes: InkStroke[], indent = "\t\t"): string {
	if (strokes.length === 0) return "";
	const attrs = (list: Array<[string, string]>) => list.map(([name, value]) => (value === "" ? name : `${name}="${value}"`)).join(" ");
	const lines = [`<svg ${attrs(INK_LAYER_ATTRIBUTES)}>`, `\t<title>${INK_TITLE}</title>`];
	for (const stroke of strokes) lines.push(`\t<path ${attrs(strokeAttributes(stroke))} />`);
	lines.push("</svg>");
	return lines.map((line, index) => (index === 0 ? line : indent + line)).join("\n");
}

// --- geometry ------------------------------------------------------------------------

interface Pt {
	x: number;
	y: number;
	p: number;
}

function toPts(points: number[]): Pt[] {
	const out: Pt[] = [];
	for (let i = 0; i + 2 < points.length; i += 3) out.push({ x: points[i] ?? 0, y: points[i + 1] ?? 0, p: points[i + 2] ?? 0.5 });
	return out;
}

const f = (n: number) => String(round1(n));

/** How wide the pen is at a pressure: the chosen size at a mouse's 0.5, thinner and wider around it. */
export function widthAt(size: number, pressure: number): number {
	return size * (0.4 + 1.2 * Math.min(1, Math.max(0, pressure)));
}

/**
 * What to draw for a stroke: a centre line to be stroked, or an outline to be filled.
 *
 * A marker, and a pen whose pressure never moved (a mouse, a finger), is a line of one width:
 * a smoothed centre line and a `stroke-width`. A pen that pressed harder and softer is an
 * outline, offset from the centre line by half the width at each point and closed with a round
 * cap at both ends, because SVG has no stroke whose width varies.
 */
export function strokeShape(stroke: InkStroke): { d: string; filled: boolean } {
	const pts = toPts(stroke.points);
	const first = pts[0];
	if (!first) return { d: "", filled: false };
	const varies = stroke.tool === "pen" && pts.some((pt) => Math.abs(pt.p - first.p) > 0.02);
	if (!varies) return { d: centreLine(pts), filled: false };
	return { d: outline(pts, stroke.size), filled: true };
}

/** Through the midpoints, with each point as a control: smooth, and it passes both ends. */
function centreLine(pts: Pt[]): string {
	const first = pts[0];
	if (!first) return "";
	// A dot: a line of no length draws nothing without round caps, and draws a disc with them.
	if (pts.length === 1) return `M${f(first.x)} ${f(first.y)}l0.01 0`;
	let d = `M${f(first.x)} ${f(first.y)}`;
	for (let i = 1; i < pts.length - 1; i++) {
		const a = pts[i] as Pt;
		const b = pts[i + 1] as Pt;
		d += `Q${f(a.x)} ${f(a.y)} ${f((a.x + b.x) / 2)} ${f((a.y + b.y) / 2)}`;
	}
	const last = pts[pts.length - 1] as Pt;
	return `${d}L${f(last.x)} ${f(last.y)}`;
}

function outline(pts: Pt[], size: number): string {
	// Pressure arrives noisy; a three-point mean keeps the edge from rippling.
	const radius = pts.map((pt, i) => {
		const before = pts[i - 1]?.p ?? pt.p;
		const after = pts[i + 1]?.p ?? pt.p;
		return widthAt(size, (before + pt.p * 2 + after) / 4) / 2;
	});
	const left: Array<{ x: number; y: number }> = [];
	const right: Array<{ x: number; y: number }> = [];
	let nx = 0;
	let ny = -1;
	for (let i = 0; i < pts.length; i++) {
		const here = pts[i] as Pt;
		const from = pts[i - 1] ?? here;
		const to = pts[i + 1] ?? here;
		const dx = to.x - from.x;
		const dy = to.y - from.y;
		const length = Math.hypot(dx, dy);
		// Two samples on one spot have no direction; the last normal is the honest guess.
		if (length > 1e-6) {
			nx = -dy / length;
			ny = dx / length;
		}
		const r = radius[i] ?? size / 2;
		left.push({ x: here.x + nx * r, y: here.y + ny * r });
		right.push({ x: here.x - nx * r, y: here.y - ny * r });
	}
	const run = (side: Array<{ x: number; y: number }>) => {
		let d = "";
		for (let i = 1; i < side.length - 1; i++) {
			const a = side[i] as { x: number; y: number };
			const b = side[i + 1] as { x: number; y: number };
			d += `Q${f(a.x)} ${f(a.y)} ${f((a.x + b.x) / 2)} ${f((a.y + b.y) / 2)}`;
		}
		const last = side[side.length - 1] as { x: number; y: number };
		return `${d}L${f(last.x)} ${f(last.y)}`;
	};
	const start = left[0] as { x: number; y: number };
	const endRadius = f(radius[radius.length - 1] ?? size / 2);
	const startRadius = f(radius[0] ?? size / 2);
	const back = [...right].reverse();
	const backStart = back[0] as { x: number; y: number };
	return (
		`M${f(start.x)} ${f(start.y)}${run(left)}` +
		`A${endRadius} ${endRadius} 0 0 1 ${f(backStart.x)} ${f(backStart.y)}${run(back)}` +
		`A${startRadius} ${startRadius} 0 0 1 ${f(start.x)} ${f(start.y)}Z`
	);
}

/**
 * Fewer points for the same line (Ramer-Douglas-Peucker on x and y, pressure carried along).
 *
 * A pencil reports 240 points a second and most of them sit on the line between their
 * neighbours. At a tolerance of 0.35 board pixels a stroke keeps about one point in six and
 * no eye can find the difference, and that ratio is the size of the file.
 */
export function simplify(points: number[], tolerance = 0.35): number[] {
	const pts = toPts(points);
	if (pts.length <= 2) return points.slice();
	const keep = new Array<boolean>(pts.length).fill(false);
	keep[0] = true;
	keep[pts.length - 1] = true;
	const stack: Array<[number, number]> = [[0, pts.length - 1]];
	while (stack.length > 0) {
		const [from, to] = stack.pop() as [number, number];
		const a = pts[from] as Pt;
		const b = pts[to] as Pt;
		let worst = 0;
		let at = -1;
		for (let i = from + 1; i < to; i++) {
			const pt = pts[i] as Pt;
			// A point whose pressure differs from the line's is kept too: it is where the width turns.
			const expected = a.p + ((b.p - a.p) * (i - from)) / (to - from);
			const distance = Math.max(segmentDistance(pt.x, pt.y, a.x, a.y, b.x, b.y), Math.abs(pt.p - expected) * 4);
			if (distance > worst) {
				worst = distance;
				at = i;
			}
		}
		if (at >= 0 && worst > tolerance) {
			keep[at] = true;
			stack.push([from, at], [at, to]);
		}
	}
	const out: number[] = [];
	pts.forEach((pt, i) => {
		if (keep[i]) out.push(pt.x, pt.y, pt.p);
	});
	return out;
}

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
	const dx = bx - ax;
	const dy = by - ay;
	const lengthSquared = dx * dx + dy * dy;
	const t = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
	return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/** Whether a disc of `radius` at a point touches the stroke: the eraser's question. */
export function hitStroke(stroke: InkStroke, x: number, y: number, radius: number): boolean {
	const pts = toPts(stroke.points);
	const reach = radius + widthAt(stroke.size, 1) / 2;
	const first = pts[0];
	if (!first) return false;
	if (pts.length === 1) return Math.hypot(x - first.x, y - first.y) <= reach;
	for (let i = 0; i < pts.length - 1; i++) {
		const a = pts[i] as Pt;
		const b = pts[i + 1] as Pt;
		if (segmentDistance(x, y, a.x, a.y, b.x, b.y) <= reach) return true;
	}
	return false;
}

/** Even-odd, so a loop that crosses itself still selects what it goes round. */
export function insidePolygon(x: number, y: number, polygon: number[]): boolean {
	let inside = false;
	const count = polygon.length / 2;
	for (let i = 0, j = count - 1; i < count; j = i++) {
		const xi = polygon[i * 2] ?? 0;
		const yi = polygon[i * 2 + 1] ?? 0;
		const xj = polygon[j * 2] ?? 0;
		const yj = polygon[j * 2 + 1] ?? 0;
		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
	}
	return inside;
}

/**
 * The strokes a lasso took: those with most of their points inside the loop (`x, y` pairs).
 *
 * "Most" rather than "all", because a hand-drawn loop clips the tail of the word it goes
 * round, and rather than "any", because a loop round one word brushes its neighbour.
 */
export function lassoPick(strokes: InkStroke[], polygon: number[]): string[] {
	if (polygon.length < 6) return [];
	return strokes
		.filter((stroke) => {
			const pts = toPts(stroke.points);
			const inside = pts.filter((pt) => insidePolygon(pt.x, pt.y, polygon)).length;
			return pts.length > 0 && inside / pts.length > 0.6;
		})
		.map((stroke) => stroke.id);
}

export interface InkBox {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** The box round some strokes, their width included. `undefined` for none. */
export function inkBounds(strokes: InkStroke[]): InkBox | undefined {
	let x0 = Infinity;
	let y0 = Infinity;
	let x1 = -Infinity;
	let y1 = -Infinity;
	for (const stroke of strokes) {
		const half = widthAt(stroke.size, 1) / 2;
		for (const pt of toPts(stroke.points)) {
			x0 = Math.min(x0, pt.x - half);
			y0 = Math.min(y0, pt.y - half);
			x1 = Math.max(x1, pt.x + half);
			y1 = Math.max(y1, pt.y + half);
		}
	}
	if (!Number.isFinite(x0)) return undefined;
	return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The same stroke, somewhere else. */
export function moveStroke(stroke: InkStroke, dx: number, dy: number): InkStroke {
	return { ...stroke, points: stroke.points.map((n, i) => (i % 3 === 0 ? round1(n + dx) : i % 3 === 1 ? round1(n + dy) : n)) };
}

// --- undo and redo -------------------------------------------------------------------

/**
 * Undo and redo for one board's ink: the lists it has been, and where in them it is now.
 *
 * Whole lists rather than inverse operations. A stroke object is shared between every list it
 * appears in, so a step costs an array of references, and "erase three, move two, undo, undo,
 * redo" needs no case analysis at all: every step is "the list is now this".
 */
export interface InkHistory {
	past: InkStroke[][];
	present: InkStroke[];
	future: InkStroke[][];
}

const HISTORY_DEPTH = 200;

export function inkHistory(present: InkStroke[] = []): InkHistory {
	return { past: [], present, future: [] };
}

export function inkCommit(history: InkHistory, next: InkStroke[]): InkHistory {
	return { past: [...history.past, history.present].slice(-HISTORY_DEPTH), present: next, future: [] };
}

export function inkUndo(history: InkHistory): InkHistory {
	const previous = history.past[history.past.length - 1];
	if (!previous) return history;
	return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] };
}

export function inkRedo(history: InkHistory): InkHistory {
	const [next, ...rest] = history.future;
	if (!next) return history;
	return { past: [...history.past, history.present], present: next, future: rest };
}
