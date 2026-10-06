/**
 * The bounding box of an SVG path string, which is what a `path` item is when it has no
 * `viewBox`: pen maps "the tight bbox of the geometry" onto the item's box.
 *
 * Exact, because this box is what the pointer is tested against: a shape measured larger than it
 * is drawn steals clicks from whatever is beside it. A curve is solved for where it turns back on
 * itself rather than bounded by its control points, and an arc for the extremes of its ellipse
 * that the sweep actually passes. Measured generously, a half-circle came out twice as tall as it
 * is drawn, and a click below an ellipse selected the ellipse.
 */

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

const COMMAND = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;

/** Tokens: command letters and numbers, in order. */
function tokens(d: string): Array<string | number> {
	const out: Array<string | number> = [];
	for (const match of d.matchAll(COMMAND)) {
		if (match[1]) out.push(match[1]);
		else if (match[2]) out.push(Number(match[2]));
	}
	return out;
}

const ARITY: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

export function pathBounds(d: string | undefined): Rect | undefined {
	if (!d) return undefined;
	const list = tokens(d);
	let x = 0;
	let y = 0;
	let startX = 0;
	let startY = 0;
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	const seeX = (px: number) => {
		if (px < minX) minX = px;
		if (px > maxX) maxX = px;
	};
	const seeY = (py: number) => {
		if (py < minY) minY = py;
		if (py > maxY) maxY = py;
	};
	const see = (px: number, py: number) => {
		seeX(px);
		seeY(py);
	};
	// The last curve's own control point, which S and T mirror to get their first one.
	let control: { x: number; y: number; of: "c" | "q" } | undefined;
	let i = 0;
	let command = "";
	while (i < list.length) {
		const token = list[i];
		if (typeof token === "string") {
			command = token;
			i++;
			if (command === "z" || command === "Z") {
				x = startX;
				y = startY;
				continue;
			}
		}
		if (!command) break;
		const lower = command.toLowerCase();
		const arity = ARITY[lower] ?? 0;
		if (arity === 0) continue;
		const args = list.slice(i, i + arity);
		if (args.length < arity || args.some((a) => typeof a !== "number")) break;
		i += arity;
		const n = args as number[];
		const rel = command === lower;
		const ox = rel ? x : 0;
		const oy = rel ? y : 0;
		switch (lower) {
			case "m":
				x = ox + n[0]!;
				y = oy + n[1]!;
				startX = x;
				startY = y;
				see(x, y);
				// Further pairs after a moveto are linetos.
				command = rel ? "l" : "L";
				break;
			case "l":
				x = ox + n[0]!;
				y = oy + n[1]!;
				see(x, y);
				break;
			case "h":
				x = (rel ? x : 0) + n[0]!;
				see(x, y);
				break;
			case "v":
				y = (rel ? y : 0) + n[0]!;
				see(x, y);
				break;
			case "c":
			case "s": {
				// S's first control point is the mirror of the last cubic's second, or the pen itself.
				const mirrored = command.toLowerCase() === "s";
				const c1 = mirrored ? (control?.of === "c" ? { x: 2 * x - control.x, y: 2 * y - control.y } : { x, y }) : { x: ox + n[0]!, y: oy + n[1]! };
				const c2 = mirrored ? { x: ox + n[0]!, y: oy + n[1]! } : { x: ox + n[2]!, y: oy + n[3]! };
				const ex = mirrored ? ox + n[2]! : ox + n[4]!;
				const ey = mirrored ? oy + n[3]! : oy + n[5]!;
				for (const v of cubicRange(x, c1.x, c2.x, ex)) seeX(v);
				for (const v of cubicRange(y, c1.y, c2.y, ey)) seeY(v);
				control = { ...c2, of: "c" };
				x = ex;
				y = ey;
				break;
			}
			case "q":
			case "t": {
				// And T's control point is the mirror of the last quadratic's.
				const mirrored = command.toLowerCase() === "t";
				const c1 = mirrored ? (control?.of === "q" ? { x: 2 * x - control.x, y: 2 * y - control.y } : { x, y }) : { x: ox + n[0]!, y: oy + n[1]! };
				const ex = mirrored ? ox + n[0]! : ox + n[2]!;
				const ey = mirrored ? oy + n[1]! : oy + n[3]!;
				for (const v of quadRange(x, c1.x, ex)) seeX(v);
				for (const v of quadRange(y, c1.y, ey)) seeY(v);
				control = { ...c1, of: "q" };
				x = ex;
				y = ey;
				break;
			}
			case "a": {
				const ex = ox + n[5]!;
				const ey = oy + n[6]!;
				const arc = arcBounds(x, y, n[0]!, n[1]!, n[2]!, n[3]! !== 0, n[4]! !== 0, ex, ey);
				see(arc.x, arc.y);
				see(arc.x + arc.w, arc.y + arc.h);
				x = ex;
				y = ey;
				see(x, y);
				break;
			}
		}
	}
	if (!Number.isFinite(minX)) return undefined;
	return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}


/**
 * Every value a cubic bézier takes at its ends and wherever it turns back, on one axis.
 *
 * The curve's own derivative is a quadratic, so its roots are the turning points; only roots
 * strictly inside the curve count, since the ends are there already.
 */
function cubicRange(a: number, b: number, c: number, d: number): number[] {
	const out = [a, d];
	const at = (t: number) => {
		const u = 1 - t;
		return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
	};
	const keep = (t: number) => {
		if (t > 0 && t < 1) out.push(at(t));
	};
	const qa = -a + 3 * b - 3 * c + d;
	const qb = 2 * (a - 2 * b + c);
	const qc = b - a;
	if (Math.abs(qa) < 1e-12) {
		if (Math.abs(qb) > 1e-12) keep(-qc / qb);
		return out;
	}
	const under = qb * qb - 4 * qa * qc;
	if (under < 0) return out;
	const root = Math.sqrt(under);
	keep((-qb + root) / (2 * qa));
	keep((-qb - root) / (2 * qa));
	return out;
}

/** The same for a quadratic bézier, whose derivative is a line and so has one turning point. */
function quadRange(a: number, b: number, c: number): number[] {
	const out = [a, c];
	const under = a - 2 * b + c;
	if (Math.abs(under) > 1e-12) {
		const t = (a - b) / under;
		if (t > 0 && t < 1) {
			const u = 1 - t;
			out.push(u * u * a + 2 * u * t * b + t * t * c);
		}
	}
	return out;
}

/**
 * The exact box of one SVG elliptical arc, from where the pen is to where it ends.
 *
 * The endpoints are given, so the centre, the start angle and the swept angle are worked out
 * first (SVG's own F.6.5), and then the box is the two ends plus whichever of the ellipse's four
 * extreme points the sweep actually passes. An extreme is where the tangent is vertical or
 * horizontal: for a rotated ellipse those angles are not the quadrant angles, which is why they
 * are solved rather than assumed.
 */
export function arcBounds(x1: number, y1: number, rxIn: number, ryIn: number, degrees: number, large: boolean, sweep: boolean, x2: number, y2: number): Rect {
	const box = (xs: number[], ys: number[]): Rect => {
		const minX = Math.min(...xs);
		const minY = Math.min(...ys);
		return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
	};
	let rx = Math.abs(rxIn);
	let ry = Math.abs(ryIn);
	// A zero radius, or no distance to cover: SVG draws a straight line, and the box is the two ends.
	if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) return box([x1, x2], [y1, y2]);
	const phi = (degrees * Math.PI) / 180;
	const cos = Math.cos(phi);
	const sin = Math.sin(phi);
	// Into the ellipse's own frame, where it is a circle of radii rx and ry about the centre.
	const dx = (x1 - x2) / 2;
	const dy = (y1 - y2) / 2;
	const px = cos * dx + sin * dy;
	const py = -sin * dx + cos * dy;
	// Radii too small to reach both ends are scaled up until they just do, as SVG says to.
	const over = (px * px) / (rx * rx) + (py * py) / (ry * ry);
	if (over > 1) {
		const grow = Math.sqrt(over);
		rx *= grow;
		ry *= grow;
	}
	const top = rx * rx * ry * ry - rx * rx * py * py - ry * ry * px * px;
	const bottom = rx * rx * py * py + ry * ry * px * px;
	const scale = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, top / bottom));
	const cxp = (scale * rx * py) / ry;
	const cyp = (-scale * ry * px) / rx;
	const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
	const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
	const at = (t: number) => [cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos] as const;
	// The angle of a point on the ellipse, measured in the ellipse's own frame.
	const theta = (ax: number, ay: number) => {
		const ux = ((ax - cx) * cos + (ay - cy) * sin) / rx;
		const uy = (-(ax - cx) * sin + (ay - cy) * cos) / ry;
		return Math.atan2(uy, ux);
	};
	const start = theta(x1, y1);
	const end = theta(x2, y2);
	let swept = end - start;
	if (sweep && swept < 0) swept += 2 * Math.PI;
	if (!sweep && swept > 0) swept -= 2 * Math.PI;
	/*
	 * Where the tangent is vertical (dx/dt = 0) and where it is horizontal (dy/dt = 0), and the
	 * same angles half a turn round. Four candidates, each kept only if the sweep passes it.
	 */
	const candidates = [Math.atan2(-ry * sin, rx * cos), Math.atan2(ry * cos, rx * sin)].flatMap((t) => [t, t + Math.PI, t - Math.PI, t + 2 * Math.PI, t - 2 * Math.PI]);
	const xs = [x1, x2];
	const ys = [y1, y2];
	for (const t of candidates) {
		const along = t - start;
		const within = swept >= 0 ? along >= 0 && along <= swept : along <= 0 && along >= swept;
		if (!within) continue;
		const [ax, ay] = at(t);
		xs.push(ax);
		ys.push(ay);
	}
	return box(xs, ys);
}
