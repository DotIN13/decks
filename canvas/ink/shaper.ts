import { type Pt, f, widthAt } from "./outline.ts";
export { widthAt, strokeShape, simplify, type InkBox, inkBounds } from "./outline.ts";
export { hitStroke, insidePolygon, lassoPick, moveStroke } from "./hit.ts";
export { type InkHistory, inkHistory, inkCommit, inkUndo, inkRedo } from "./history.ts";

/**
 * Ink: what a person draws with a pen, a finger or a mouse — the shapes, the colours and the
 * geometry the canvas's eraser, lasso and moves are computed from.
 *
 * A stroke keeps what was drawn: `x,y,pressure` triples, which a browser's outline cannot give
 * back once a pen's pressure has been turned into one.
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
/**
 * `strokeShape` for a stroke that grows: the same path text, character for character, at every
 * length, but each call shapes only the points added since the last one, and the end, which a new
 * point bends. Shaping all of a long stroke again for every frame it is drawn cost more each frame
 * the longer it got.
 *
 * Every piece of the path but its end is fixed once the point after it has come: the centre line's
 * curve through point i is made from points i and i + 1; an outline's side at point i from points
 * i − 1 to i + 1, and its way back runs from the end to the start, so it is kept back to front and
 * each new piece goes at its front. Points that are not the ones last given grown by more (a new
 * array, fewer points, the last one changed, another tool or size) are shaped from the start.
 */
export interface InkShaper {
	shape(stroke: InkStroke): { d: string; filled: boolean };
}
type XY = { x: number; y: number };

/** What a shaper keeps of the stroke it last shaped, so the next frame only adds what is new. */
type ShaperState = {
	points: number[] | undefined;
	tool: InkStroke["tool"] | undefined;
	size: number;
	/** Points read so far, and whether the pressure moved among them. */
	pts: Pt[];
	varies: boolean;
	/** The centre line: `M` and the curves through points 1 … n − 2. */
	line: string;
	/** The outline, fixed up to point `fixed` − 1 (a point's sides need the point after it). */
	fixed: number;
	radius: number[];
	left: XY[];
	right: XY[];
	normal: { nx: number; ny: number };
	/** The left side's curves through 1 … fixed − 2, and the way back's through fixed − 1 … 1, in the order drawn. */
	leftRun: string;
	backRun: string;
};

export function inkShaper(): InkShaper {
	const s: ShaperState = { points: undefined, tool: undefined, size: 0, pts: [], varies: false, line: "", fixed: 0, radius: [], left: [], right: [], normal: { nx: 0, ny: -1 }, leftRun: "", backRun: "" };
	return { shape: (stroke) => shapeStroke(s, stroke) };
}

function resetShaper(s: ShaperState, stroke: InkStroke): void {
	s.points = stroke.points;
	s.tool = stroke.tool;
	s.size = stroke.size;
	s.pts.length = 0;
	s.varies = false;
	s.line = "";
	s.fixed = 0;
	s.radius.length = 0;
	s.left.length = 0;
	s.right.length = 0;
	s.normal.nx = 0;
	s.normal.ny = -1;
	s.leftRun = "";
	s.backRun = "";
}

const q = (a: XY, b: XY) => `Q${f(a.x)} ${f(a.y)} ${f((a.x + b.x) / 2)} ${f((a.y + b.y) / 2)}`;

/** Point i of the outline (as `outline` makes it), turning `towards` when the point has a direction. */
function sides(s: ShaperState, i: number, towards: { nx: number; ny: number }) {
	const pts = s.pts;
	const pt = pts[i] as Pt;
	const before = pts[i - 1]?.p ?? pt.p;
	const after = pts[i + 1]?.p ?? pt.p;
	const r = widthAt(s.size, (before + pt.p * 2 + after) / 4) / 2;
	const from = pts[i - 1] ?? pt;
	const to = pts[i + 1] ?? pt;
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const length = Math.hypot(dx, dy);
	if (length > 1e-6) {
		towards.nx = -dy / length;
		towards.ny = dx / length;
	}
	return { r, l: { x: pt.x + towards.nx * r, y: pt.y + towards.ny * r }, rt: { x: pt.x - towards.nx * r, y: pt.y - towards.ny * r } };
}

function outlineNow(s: ShaperState): string {
	const n = s.pts.length;
	const { radius, left, right } = s;
	for (; s.fixed < n - 1; s.fixed++) {
		const i = s.fixed;
		const { r, l, rt } = sides(s, i, s.normal);
		radius.push(r);
		left.push(l);
		right.push(rt);
		if (i >= 2) s.leftRun += q(left[i - 1] as XY, l);
		if (i >= 1) s.backRun = q(rt, right[i - 1] as XY) + s.backRun;
	}
	// The last point, from a copy of the normal: it changes when the next one comes.
	const end = sides(s, n - 1, { ...s.normal });
	const start = left[0] ?? end.l;
	const startRadius = f(radius[0] ?? end.r);
	const endRadius = f(end.r);
	const leftEnd = n >= 3 ? q(left[n - 2] as XY, end.l) : "";
	const backEnd = right[0] ?? end.rt;
	return (
		`M${f(start.x)} ${f(start.y)}${s.leftRun}${leftEnd}L${f(end.l.x)} ${f(end.l.y)}` +
		`A${endRadius} ${endRadius} 0 0 1 ${f(end.rt.x)} ${f(end.rt.y)}${s.backRun}L${f(backEnd.x)} ${f(backEnd.y)}` +
		`A${startRadius} ${startRadius} 0 0 1 ${f(start.x)} ${f(start.y)}Z`
	);
}

/** The points given are the ones read, and maybe more after them. */
function grown(s: ShaperState, stroke: InkStroke): boolean {
	if (stroke.points !== s.points || stroke.tool !== s.tool || stroke.size !== s.size) return false;
	const last = s.pts[s.pts.length - 1];
	if (!last) return true;
	const at = (s.pts.length - 1) * 3;
	return stroke.points.length >= at + 3 && stroke.points[at] === last.x && stroke.points[at + 1] === last.y && stroke.points[at + 2] === last.p;
}

function shapeStroke(s: ShaperState, stroke: InkStroke): { d: string; filled: boolean } {
	if (!grown(s, stroke)) resetShaper(s, stroke);
	const pts = s.pts;
	const from = pts.length;
	for (let i = from * 3; i + 2 < stroke.points.length; i += 3) pts.push({ x: stroke.points[i] ?? 0, y: stroke.points[i + 1] ?? 0, p: stroke.points[i + 2] ?? 0.5 });
	const first = pts[0];
	if (!first) return { d: "", filled: false };
	if (stroke.tool === "pen" && !s.varies) {
		for (let i = from; i < pts.length; i++) {
			if (Math.abs((pts[i] as Pt).p - first.p) > 0.02) {
				s.varies = true;
				break;
			}
		}
	}
	if (s.varies) return { d: outlineNow(s), filled: true };
	const n = pts.length;
	if (n === 1) return { d: `M${f(first.x)} ${f(first.y)}l0.01 0`, filled: false };
	s.line ||= `M${f(first.x)} ${f(first.y)}`;
	for (let i = Math.max(1, from - 1); i < n - 1; i++) s.line += q(pts[i] as Pt, pts[i + 1] as Pt);
	const last = pts[n - 1] as Pt;
	return { d: `${s.line}L${f(last.x)} ${f(last.y)}`, filled: false };
}
