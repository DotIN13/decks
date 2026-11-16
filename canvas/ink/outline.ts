import { type InkStroke } from "./shaper.ts";

// A stroke's geometry: the path it is drawn as, its points thinned once it
// is done, and the box round some strokes.

export const round1 = (n: number) => Math.round(n * 10) / 10;

// The path a stroke is drawn as.
export interface Pt {
	x: number;
	y: number;
	p: number;
}
export function toPts(points: number[]): Pt[] {
	const out: Pt[] = [];
	for (let i = 0; i + 2 < points.length; i += 3) out.push({ x: points[i] ?? 0, y: points[i + 1] ?? 0, p: points[i + 2] ?? 0.5 });
	return out;
}
export const f = (n: number) => String(round1(n));
/** How wide the pen is at a pressure: the chosen size at a mouse's 0.5, thinner and wider around it. */
export function widthAt(size: number, pressure: number): number {
	return size * (0.4 + 1.2 * Math.min(1, Math.max(0, pressure)));
}
/**
 * What to draw for a stroke. A marker, or a pen whose pressure never moved, is a smoothed centre line
 * of one width; a pen pressed harder and softer is an outline, half the width either side of each
 * point with round caps, because SVG has no stroke whose width varies.
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
// Fewer points, once the pen lifts.
/**
 * Fewer points for the same line (Ramer-Douglas-Peucker on x and y, pressure carried along). At a
 * tolerance of 0.35 pixels a pencil's 240 points a second keep about one in six, and no eye can
 * find the difference.
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
/** How far a point is from the segment a to b. */
export function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
	const dx = bx - ax;
	const dy = by - ay;
	const lengthSquared = dx * dx + dy * dy;
	const t = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
	return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}
// The box round some strokes.
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
