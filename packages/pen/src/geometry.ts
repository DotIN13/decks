/**
 * The bounding box of an SVG path string, which is what a `path` item is when it has no
 * `viewBox`: pen maps "the tight bbox of the geometry" onto the item's box.
 *
 * Control points are included, so the box can be a little generous around a curve. That is the
 * safe side: a box that contains the drawing, where the exact curve extremes would need solving
 * cubics and buy nothing an agent placing an arrow would notice.
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
	const see = (px: number, py: number) => {
		if (px < minX) minX = px;
		if (py < minY) minY = py;
		if (px > maxX) maxX = px;
		if (py > maxY) maxY = py;
	};
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
			case "t":
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
				see(ox + n[0]!, oy + n[1]!);
				see(ox + n[2]!, oy + n[3]!);
				x = ox + n[4]!;
				y = oy + n[5]!;
				see(x, y);
				break;
			case "s":
			case "q":
				see(ox + n[0]!, oy + n[1]!);
				x = ox + n[2]!;
				y = oy + n[3]!;
				see(x, y);
				break;
			case "a": {
				// The arc's own extent is bounded by its radii around both ends.
				const ex = ox + n[5]!;
				const ey = oy + n[6]!;
				const rx = Math.abs(n[0]!);
				const ry = Math.abs(n[1]!);
				see(Math.min(x, ex) - rx, Math.min(y, ey) - ry);
				see(Math.max(x, ex) + rx, Math.max(y, ey) + ry);
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
