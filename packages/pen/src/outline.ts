import { pathBounds } from "./geometry.ts";
import { isShape, shapeOutline } from "./shapes.ts";
import type { PenDocument, PenNode } from "./types.ts";
import { num, radiiOf, type ThemeState } from "./values.ts";

/**
 * An item's outline as one SVG path string in its own space: 0,0 is its top-left corner and w,h
 * its bottom-right, as the engine draws it (`stage/crates/paint/src/mesh.rs`). A path's geometry is
 * mapped from its viewBox (or the geometry's own bounds) onto its box; a rectangle has its rounded
 * corners, an ellipse its arc or ring, a polygon its corners, and a Decks shape the outline it is
 * drawn with. Anything else has none.
 */
export function outlineOf(doc: PenDocument, node: PenNode, w: number, h: number, theme: ThemeState): string | undefined {
	switch (node.type) {
		case "path":
			return mapped(node, w, h);
		case "rectangle":
			return rounded(w, h, radiiOf(doc, node, theme));
		case "ellipse":
			return ellipse(w, h, num(doc, node.innerRadius, theme, 0), num(doc, node.startAngle, theme, 0), num(doc, node.sweepAngle, theme, 360));
		case "polygon":
			return polygon(w, h, Math.max(3, Math.round(num(doc, node.polygonCount, theme, 3))));
		case "frame": {
			if (!isShape(node)) return undefined;
			const outline = shapeOutline(node);
			return outline ? mapped(outline, w, h) : undefined;
		}
		default:
			return undefined;
	}
}

const r2 = (n: number) => {
	const v = Math.round(n * 100) / 100;
	return Object.is(v, -0) ? "0" : String(v);
};
const pt = (x: number, y: number) => `${r2(x)} ${r2(y)}`;

function rounded(w: number, h: number, radii: [number, number, number, number]): string {
	const most = Math.min(w, h) / 2;
	const [tl, tr, br, bl] = radii.map((r) => Math.max(0, Math.min(r, most))) as [number, number, number, number];
	if (!tl && !tr && !br && !bl) return `M${pt(0, 0)} L${pt(w, 0)} L${pt(w, h)} L${pt(0, h)} Z`;
	const arc = (r: number, x: number, y: number) => (r ? ` A${r2(r)} ${r2(r)} 0 0 1 ${pt(x, y)}` : "");
	return `M${pt(tl, 0)} L${pt(w - tr, 0)}${arc(tr, w, tr)} L${pt(w, h - br)}${arc(br, w - br, h)} L${pt(bl, h)}${arc(bl, 0, h - bl)} L${pt(0, tl)}${arc(tl, tl, 0)} Z`;
}

/** An arc from `a0` through `da` radians (screen angles, y down), in pieces of at most a half turn so each is one A. */
function arcTo(cx: number, cy: number, rx: number, ry: number, a0: number, da: number): string {
	const pieces = Math.max(1, Math.ceil(Math.abs(da) / Math.PI));
	let out = "";
	for (let i = 1; i <= pieces; i++) {
		const a = a0 + (da * i) / pieces;
		out += ` A${r2(rx)} ${r2(ry)} 0 0 ${da > 0 ? 1 : 0} ${pt(cx + rx * Math.cos(a), cy + ry * Math.sin(a))}`;
	}
	return out;
}

function ellipse(w: number, h: number, inner: number, start: number, sweep: number): string {
	const [cx, cy, rx, ry] = [w / 2, h / 2, w / 2, h / 2];
	const at = (sx: number, sy: number, a: number) => pt(cx + sx * Math.cos(a), cy + sy * Math.sin(a));
	if (Math.abs(sweep) >= 360) {
		const ring = (sx: number, sy: number) => `M${at(sx, sy, 0)}${arcTo(cx, cy, sx, sy, 0, Math.PI * 2)} Z`;
		return inner > 0 ? `${ring(rx, ry)} ${ring(rx * inner, ry * inner)}` : ring(rx, ry);
	}
	// Counter-clockwise on a screen whose y grows down is a negative angle.
	const a0 = (-start * Math.PI) / 180;
	const da = (-sweep * Math.PI) / 180;
	if (inner > 0) return `M${at(rx, ry, a0)}${arcTo(cx, cy, rx, ry, a0, da)} L${at(rx * inner, ry * inner, a0 + da)}${arcTo(cx, cy, rx * inner, ry * inner, a0 + da, -da)} Z`;
	return `M${pt(cx, cy)} L${at(rx, ry, a0)}${arcTo(cx, cy, rx, ry, a0, da)} Z`;
}

function polygon(w: number, h: number, sides: number): string {
	const points = Array.from({ length: sides }, (_, i) => {
		const a = -Math.PI / 2 + (i * Math.PI * 2) / sides;
		return pt(w / 2 + (w / 2) * Math.cos(a), h / 2 + (h / 2) * Math.sin(a));
	});
	return `M${points.join(" L")} Z`;
}

const COMMAND = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
const ARITY: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

/** A path item's geometry, made absolute and mapped from its viewBox onto 0..w, 0..h. */
function mapped(node: PenNode, w: number, h: number): string | undefined {
	const d = typeof node.geometry === "string" ? node.geometry.trim() : "";
	if (!d) return undefined;
	const vb = Array.isArray(node.viewBox) && node.viewBox.length === 4 ? node.viewBox : (() => {
		const b = pathBounds(d);
		return b ? ([b.x, b.y, b.w, b.h] as [number, number, number, number]) : undefined;
	})();
	if (!vb) return undefined;
	const sx = vb[2] ? w / vb[2] : 1;
	const sy = vb[3] ? h / vb[3] : 1;
	const X = (x: number) => (x - vb[0]) * sx;
	const Y = (y: number) => (y - vb[1]) * sy;
	const list: Array<string | number> = [];
	for (const m of d.matchAll(COMMAND)) list.push(m[1] ? m[1] : Number(m[2]));
	const out: string[] = [];
	let [x, y, startX, startY] = [0, 0, 0, 0];
	let i = 0;
	let command = "";
	while (i < list.length) {
		if (typeof list[i] === "string") command = list[i++] as string;
		else if (!command) return undefined;
		const lower = command.toLowerCase();
		const rel = command !== command.toUpperCase();
		const n = ARITY[lower] ?? 0;
		if (lower === "z") {
			out.push("Z");
			[x, y] = [startX, startY];
			continue;
		}
		const args = list.slice(i, i + n);
		if (args.length < n || args.some((a) => typeof a !== "number")) break;
		i += n;
		const v = args as number[];
		const ax = (k: number) => (rel ? x + v[k]! : v[k]!);
		const ay = (k: number) => (rel ? y + v[k]! : v[k]!);
		switch (lower) {
			case "m":
				[x, y] = [ax(0), ay(1)];
				[startX, startY] = [x, y];
				out.push(`M${pt(X(x), Y(y))}`);
				// Further pairs after a move are lines.
				command = rel ? "l" : "L";
				break;
			case "l":
				[x, y] = [ax(0), ay(1)];
				out.push(`L${pt(X(x), Y(y))}`);
				break;
			case "h":
				x = rel ? x + v[0]! : v[0]!;
				out.push(`L${pt(X(x), Y(y))}`);
				break;
			case "v":
				y = rel ? y + v[0]! : v[0]!;
				out.push(`L${pt(X(x), Y(y))}`);
				break;
			case "c":
				out.push(`C${pt(X(ax(0)), Y(ay(1)))} ${pt(X(ax(2)), Y(ay(3)))} ${pt(X(ax(4)), Y(ay(5)))}`);
				[x, y] = [ax(4), ay(5)];
				break;
			case "s":
				out.push(`S${pt(X(ax(0)), Y(ay(1)))} ${pt(X(ax(2)), Y(ay(3)))}`);
				[x, y] = [ax(2), ay(3)];
				break;
			case "q":
				out.push(`Q${pt(X(ax(0)), Y(ay(1)))} ${pt(X(ax(2)), Y(ay(3)))}`);
				[x, y] = [ax(2), ay(3)];
				break;
			case "t":
				[x, y] = [ax(0), ay(1)];
				out.push(`T${pt(X(x), Y(y))}`);
				break;
			case "a": {
				const [ex, ey] = [rel ? x + v[5]! : v[5]!, rel ? y + v[6]! : v[6]!];
				out.push(`A${r2(Math.abs(v[0]! * sx))} ${r2(Math.abs(v[1]! * sy))} ${r2(v[2]!)} ${v[3] ? 1 : 0} ${(v[4] ? 1 : 0) ^ (sx * sy < 0 ? 1 : 0)} ${pt(X(ex), Y(ey))}`);
				[x, y] = [ex, ey];
				break;
			}
		}
	}
	return out.length ? out.join(" ") : undefined;
}
