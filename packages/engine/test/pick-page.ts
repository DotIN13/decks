// The page for `pick-diff.mjs`: today's picking (copied from `apps/web/src/canvas/pen/layer.ts`,
// `hitTest` before its group climb, and `within`), and the C++ picker, on the same layouts.
import { estimateText, expand, baseTheme, indexOf, isShape, layout, pathBounds, type Frame, type PenDocument, type Placed } from "@decks/pen";
import { BoxIndex } from "../../../apps/web/src/canvas/spatial.ts";
import { boundsOf } from "../../../apps/web/src/canvas/pen/bounds.ts";
import { loadPicker } from "../src/pick.ts";

const BAND_PX = 8;
const ctx = document.createElement("canvas").getContext("2d")!;

function onPath(placed: Placed, point: { x: number; y: number }, zoom: number): boolean | undefined {
	const { node } = placed;
	if (typeof node.geometry !== "string" || !node.geometry) return undefined;
	const vb = node.viewBox ?? (() => {
		const b = pathBounds(node.geometry as string);
		return b ? ([b.x, b.y, b.w, b.h] as const) : undefined;
	})();
	if (!vb || vb[2] <= 0 || vb[3] <= 0) return undefined;
	const path = new Path2D(node.geometry);
	const box = placed.box;
	const sx = box.w / vb[2];
	const sy = box.h / vb[3];
	if (!(sx > 0) || !(sy > 0)) return undefined;
	const px = (point.x - box.x) / sx + vb[0];
	const py = (point.y - box.y) / sy + vb[1];
	const drawn = typeof node.strokeWidth === "number" ? node.strokeWidth : 0;
	ctx.lineWidth = Math.max(drawn, (2 * BAND_PX) / zoom) / Math.max(sx, sy);
	const filled = node.fill !== undefined && node.fill !== null;
	return ctx.isPointInStroke(path, px, py) || (filled && ctx.isPointInPath(path, px, py));
}

function reference(placed: Map<string, Placed>, bounds: Map<string, Frame>) {
	const list = [...placed.values()];
	const index = new BoxIndex(list.map((one) => bounds.get(one.node.id) ?? one.box));
	return {
		hit(point: { x: number; y: number }, zoom: number): string | undefined {
			let best: Placed | undefined;
			for (const at of index.search({ x: point.x, y: point.y, w: 0, h: 0 })) {
				const one = list[at]!;
				const { node } = one;
				if (node.id.includes("/") || node.type === "group") continue;
				if (node.type === "browser" && node.metadata?.type === "decks.board") continue;
				const box = bounds.get(node.id) ?? one.box;
				if (point.x < box.x || point.x > box.x + box.w || point.y < box.y || point.y > box.y + box.h) continue;
				if (node.type === "path" && onPath(one, point, zoom) === false) continue;
				if (!best || one.order > best.order) best = one;
			}
			return best?.node.id;
		},
		within(doc: PenDocument, r: Frame): string[] {
			const idx = indexOf(doc);
			const inside = new Set<string>();
			for (const at of index.search(r)) {
				const { node, box: given } = list[at]!;
				if (node.id.includes("/") || (node.type === "browser" && node.metadata?.type === "decks.board")) continue;
				if (isShape(idx.get(node.id)?.parent)) continue;
				const box = bounds.get(node.id) ?? given;
				if (box.x >= r.x && box.y >= r.y && box.x + box.w <= r.x + r.w && box.y + box.h <= r.y + r.h) inside.add(node.id);
			}
			return [...inside].filter((id) => {
				for (let parent = idx.get(id)?.parent; parent; parent = idx.get(parent.id)?.parent) if (inside.has(parent.id)) return false;
				return true;
			});
		},
	};
}

declare global {
	interface Window {
		run(docs: PenDocument[], seed: number): Promise<unknown>;
	}
}

window.run = async (docs, seed) => {
	const picker = await loadPicker();
	let s = seed;
	const rand = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
	const out = { presses: 0, pressDiffer: 0, cppExtra: 0, cppMissed: 0, atTheEdge: 0, farFromEdge: 0, farMissed: 0, marquees: 0, marqueeDiffer: 0, examples: [] as unknown[], sentAgain: -1 };
	for (const doc of docs) {
		const placed = layout(doc, expand(doc), { theme: baseTheme(doc, "light"), measure: estimateText });
		const bounds = boundsOf(placed);
		picker.sync(placed, bounds);
		const ref = reference(placed, bounds);
		const items = [...placed.values()];
		if (!items.length) continue;
		for (let k = 0; k < 400; k++) {
			const zoom = [0.1, 0.5, 1, 2, 4][Math.floor(rand() * 5)]!;
			const one = items[Math.floor(rand() * items.length)]!;
			const b = bounds.get(one.node.id) ?? one.box;
			// Points in and just round an item's box, where the answers can differ.
			const point = { x: b.x - 10 + rand() * (b.w + 20), y: b.y - 10 + rand() * (b.h + 20) };
			const want = ref.hit(point, zoom);
			const got = picker.point(point.x, point.y, (2 * BAND_PX) / zoom)[0];
			out.presses++;
			if (want !== got) {
				out.pressDiffer++;
				const order = (id: string | undefined) => (id ? placed.get(id)!.order : -1);
				const extra = order(got) > order(want);
				if (extra) out.cppExtra++;
				else out.cppMissed++;
				// Within 2 screen pixels of the edge of the line's reach either way, a press can go either way.
				const item = placed.get((extra ? got : want)!)!;
				const geo = String(item.node.geometry ?? "");
				const vb = item.node.viewBox ?? (() => { const bb = pathBounds(geo); return bb ? [bb.x, bb.y, bb.w, bb.h] : [0, 0, 1, 1]; })();
				const sx = item.box.w / vb[2]!, sy = item.box.h / vb[3]!;
				const width = Math.max(typeof item.node.strokeWidth === "number" ? item.node.strokeWidth : 0, (2 * BAND_PX) / zoom) / Math.max(sx, sy);
				const slack = (2 * 2) / zoom / Math.max(sx, sy);
				const path = new Path2D(geo);
				const px = (point.x - item.box.x) / sx + vb[0]!, py = (point.y - item.box.y) / sy + vb[1]!;
				ctx.lineCap = "round";
				ctx.lineJoin = "round";
				ctx.lineWidth = width + slack;
				const nearOuter = ctx.isPointInStroke(path, px, py);
				ctx.lineWidth = Math.max(0.01, width - slack);
				const nearInner = ctx.isPointInStroke(path, px, py);
				// A fill's edge counts too: within the slack of its outline.
				ctx.lineWidth = 2 * slack;
				const nearOutline = ctx.isPointInStroke(path, px, py);
				ctx.lineCap = "butt";
				ctx.lineJoin = "miter";
				const edge = item.node.type === "path" && ((nearOuter && !nearInner) || nearOutline);
				if (edge) out.atTheEdge++;
				else {
					out.farFromEdge++;
					if (!extra) out.farMissed++;
					if (out.examples.length < 14) out.examples.push({ zoom, extra, item: { id: item.node.id, type: item.node.type, geometry: geo.slice(0, 160), fill: item.node.fill, sw: item.node.strokeWidth, vb: item.node.viewBox, box: item.box }, pathPoint: [px, py], width });
				}
			}
		}
		for (let k = 0; k < 60; k++) {
			const x = (rand() - 0.5) * 3000, y = (rand() - 0.5) * 3000;
			const r = { x, y, w: rand() * 2000, h: rand() * 2000 };
			const want = ref.within(doc, r).sort().join(",");
			const got = picker.within(r).sort().join(",");
			out.marquees++;
			if (want !== got) {
				out.marqueeDiffer++;
				if (out.examples.length < 8) out.examples.push({ marquee: r, want, got });
			}
		}
	}
	// The same layout again sends nothing.
	const last = docs[docs.length - 1]!;
	const placed = layout(last, expand(last), { theme: baseTheme(last, "light"), measure: estimateText });
	picker.sync(placed, boundsOf(placed));
	picker.sync(placed, boundsOf(placed));
	out.sentAgain = picker.sent;
	return out;
};

declare global {
	interface Window {
		scan(geometry: string, zoom: number, fill: boolean): Promise<unknown>;
	}
}
window.scan = async (geometry, zoom, fill) => {
	const picker = await loadPicker();
	const node = { type: "path", id: "x", geometry, x: 0, y: 0, ...(fill ? { fill: "#000" } : {}) } as never;
	const doc = { version: "2.6", children: [node] } as PenDocument;
	const placed = layout(doc, expand(doc), { theme: {}, measure: estimateText });
	const bounds = boundsOf(placed);
	picker.sync(placed, bounds);
	const ref = reference(placed, bounds);
	const b = placed.get("x")!.box;
	const diffs: unknown[] = [];
	let n = 0;
	for (let y = b.y - 20; y <= b.y + b.h + 20; y += 1)
		for (let x = b.x - 20; x <= b.x + b.w + 20; x += 1) {
			const want = !!ref.hit({ x, y }, zoom);
			const got = picker.point(x, y, 16 / zoom).length > 0;
			if (want !== got) {
				n++;
				if (diffs.length < 6) diffs.push({ x, y, want, got });
			}
		}
	return { box: b, n, diffs };
};
