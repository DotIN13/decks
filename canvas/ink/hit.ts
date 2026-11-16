import { type InkStroke } from "./shaper.ts";
import { type Pt, round1, segmentDistance, toPts, widthAt } from "./outline.ts";

// Which strokes a point or a loop touches: the eraser's and the lasso's
// questions, and a stroke moved.

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
 * The strokes a lasso took: those with most of their points inside the loop (`x, y` pairs). Not all
 * (a drawn loop clips the tail of its word) and not any (it brushes the neighbour).
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
/** The same stroke, somewhere else. */
export function moveStroke(stroke: InkStroke, dx: number, dy: number): InkStroke {
	return { ...stroke, points: stroke.points.map((n, i) => (i % 3 === 0 ? round1(n + dx) : i % 3 === 1 ? round1(n + dy) : n)) };
}
