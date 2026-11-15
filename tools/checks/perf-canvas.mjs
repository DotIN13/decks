/**
 * The `perf` canvas: a big, busy canvas for `checks/render-perf.mjs`, made the same every time.
 *
 * 100 cells on a 10 × 10 grid centred on the origin, each 1,600 × 1,200: a small card (its own folder under the
 * canvas's `cards/`), and twenty items round it — notes, text, rectangles and ellipses, a frame with
 * three children, arrows joining them, and ink strokes. That is 2,000 items and 100 cards.
 *
 * It is written into a deck when the check runs, not kept in `e2e/fixture/`: the deck lists every
 * canvas's cards as its own, so 100 cards in the fixture would be in every other check's deck too.
 *
 *   node e2e/perf-canvas.mjs <deck folder> [items] [cards]    # write it into a deck
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PERF_CANVAS = "perf";
export const CELL = { w: 1600, h: 1200 };
export const GRID = 10;

/** A small seeded random, so the canvas is the same on every run. */
function random(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const WORDS = "the agent keeps a value for each square and moves toward the larger one until the cake is found reward state action return episode model policy step".split(" ");
const COLOURS = ["#fde68a", "#bfdbfe", "#bbf7d0", "#fecaca", "#ddd6fe", "#fed7aa"];
const INKS = ["#e5484d", "#3b82f6", "#16a34a", "#111827"];

/** A card's `index.html`, as `decks card create` writes one: a piece of HTML, drawn in the canvas's page. */
const card = (n) => `<title>Perf card ${n}</title>
<meta name="card" content='{"w":600,"h":400}' />
<style>
	.doc { padding: 32px; font-size: 17px; line-height: 1.5 }
</style>
<div class="doc" data-id="doc">
<h2>Card ${n}</h2>
<p>A generated card for the render-perf canvas: a heading, a line of words and a list.</p>
<ul><li>one</li><li>two</li><li>three</li></ul>
</div>
`;

/** The canvas's drawing and its cards' files: `{ pen, cards: [{ name, html }] }`, each `name` a folder in `cards/`. */
export function perfCanvas({ items = 2000, cards = 100 } = {}) {
	const rand = random(20261021);
	const pick = (list) => list[Math.floor(rand() * list.length)];
	const words = (n) => Array.from({ length: n }, () => pick(WORDS)).join(" ");
	const children = [];
	const files = [];
	let made = 0;
	const cells = GRID * GRID;
	/*
	 * A smaller canvas (fewer than 20 items a cell) fills the cells nearest the origin first, where the
	 * page opens and the check drags and edits, so it is the same kind of busy there, only smaller.
	 */
	const order = Array.from({ length: cells }, (_, c) => c);
	if (items < cells * 20) {
		const far = (c) => Math.hypot((c % GRID) - GRID / 2 + 0.5, Math.floor(c / GRID) - GRID / 2 + 0.5);
		order.sort((a, b) => far(a) - far(b) || a - b);
	}
	for (const c of order) {
		// Centred on the origin, where a canvas opens: the page's first view is a busy one.
		const ox = ((c % GRID) - GRID / 2) * CELL.w;
		const oy = (Math.floor(c / GRID) - GRID / 2) * CELL.h;
		if (c < cards) {
			const name = `perf-${String(c).padStart(3, "0")}`;
			// Relative to the canvas's own folder, as a canvas names its cards.
			const path = `cards/${name}/index.html`;
			files.push({ name, html: card(c) });
			children.push({ type: "browser", id: `pc${c}`, name: `Perf card ${c}`, url: path, width: 600, height: 400, metadata: { type: "decks.card", path }, x: ox + 40, y: oy + 40 });
		}
		const ids = [];
		const add = (node) => {
			if (made >= items) return false;
			children.push(node);
			ids.push(node.id);
			made++;
			return true;
		};
		let k = 0;
		const id = () => `p${c}-${k++}`;
		const at = () => ({ x: ox + 700 + Math.round(rand() * 800), y: oy + 40 + Math.round(rand() * 1000) });
		// 20 per cell: 5 notes, 3 text, 3 shapes, a frame of 3 (4 items), 2 arrows, 3 ink.
		for (let i = 0; i < 5; i++) add({ type: "note", id: id(), width: 220, metadata: { type: "decks.markdown" }, content: `**${words(2)}** ${words(10 + Math.floor(rand() * 10))}`, ...at() });
		for (let i = 0; i < 3; i++) add({ type: "text", id: id(), content: words(4 + Math.floor(rand() * 6)), fontSize: 16 + Math.floor(rand() * 4) * 4, fill: "#374151", textGrowth: "fixed-width", width: 260, ...at() });
		for (let i = 0; i < 3; i++) add({ type: i === 1 ? "ellipse" : "rectangle", id: id(), fill: pick(COLOURS), cornerRadius: i === 1 ? undefined : 10, width: 80 + Math.round(rand() * 120), height: 60 + Math.round(rand() * 80), ...at() });
		{
			const where = { x: ox + 60, y: oy + 520 };
			const frame = { type: "frame", id: id(), name: `Column ${c}`, layout: "vertical", gap: 10, padding: 14, fill: "#f3f4f6", cornerRadius: 12, width: 280, children: [], ...where };
			for (let i = 0; i < 3; i++) frame.children.push({ type: i === 0 ? "text" : "note", id: id(), ...(i === 0 ? { content: `Column ${c}`, fontSize: 20, fontWeight: "700", fill: "#111827" } : { metadata: { type: "decks.markdown" }, content: words(8) }), width: 252 });
			if (made + 4 <= items) {
				children.push(frame);
				ids.push(frame.id);
				made += 4;
			}
		}
		for (let i = 0; i < 2 && ids.length > 2; i++) {
			const from = ids[i];
			const to = ids[ids.length - 1 - i];
			add({ type: "path", id: id(), stroke: "#6b7280", strokeWidth: 3, strokeLinecap: "round", strokeLinejoin: "round", geometry: "M2 2 L200 100", x: ox + 300, y: oy + 300, width: 202, height: 102, viewBox: [0, 0, 202, 102], metadata: { type: "decks.arrow", from: { item: from }, to: { item: to }, route: i ? "elbow" : "curved" } });
		}
		for (let i = 0; i < 3; i++) {
			const pts = [];
			let x = 4;
			let y = 4 + rand() * 60;
			for (let p = 0; p < 24; p++) {
				pts.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
				x += 6 + rand() * 6;
				y += (rand() - 0.5) * 18;
				y = Math.max(4, Math.min(116, y));
			}
			const w = Math.ceil(Math.max(...pts.map((p) => p[0]))) + 4;
			add({
				type: "path",
				id: id(),
				name: "Ink",
				...at(),
				width: w,
				height: 120,
				viewBox: [0, 0, w, 120],
				geometry: `M${pts.map((p) => p.join(" ")).join("L")}`,
				stroke: pick(INKS),
				strokeWidth: 4,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				metadata: { type: "decks.ink", tool: "pen", size: 4, points: pts.flatMap((p) => [p[0], p[1], 0.5]) },
			});
		}
	}
	return { pen: { version: "2.14", children }, cards: files, items: made };
}

/** Write the canvas into `deck`: `canvases/perf/canvas.pen`, its `canvas.json` and its cards. */
export function writePerfCanvas(deck, options) {
	const { pen, cards, items } = perfCanvas(options);
	const folder = join(deck, "canvases", PERF_CANVAS);
	for (const { name, html } of cards) {
		mkdirSync(join(folder, "cards", name), { recursive: true });
		writeFileSync(join(folder, "cards", name, "index.html"), html);
	}
	writeFileSync(join(folder, "canvas.json"), `${JSON.stringify({ title: "perf" })}\n`);
	writeFileSync(join(folder, "canvas.pen"), JSON.stringify(pen));
	return { folder, items, cards: cards.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const [deck, items, cards] = process.argv.slice(2);
	if (!deck) {
		console.error("usage: node e2e/perf-canvas.mjs <deck folder> [items] [cards]");
		process.exit(2);
	}
	console.log(JSON.stringify(writePerfCanvas(resolve(deck), { items: Number(items ?? 2000), cards: Number(cards ?? 100) })));
}
