/**
 * The `awake` canvas: a canvas heavy with placed items of every kind, made the same every time, for
 * `checks/awake-bench.mjs` (the numbers) and `checks/awake.mjs` (the behaviour). Not the render-perf grid,
 * which is drawing-heavy: this one is about the items that wake and sleep.
 *
 * `writeAwakeCanvas(deck, { cards, apps, documents })` writes `canvases/awake/` into a deck: a grid of cells,
 * each holding one item (a card in its own folder under `cards/`, an app item for an app written into
 * the deck's `apps/`, or a document item for a markdown file written into `docs/`) and two notes beside
 * it, so the sheet has something to paint too. Items are dealt out in file order: card, card, card, app,
 * card, card, card, document, … so every kind is near the middle at every zoom.
 *
 * Every app is the same small static page that animates (a clock redrawn ten times a second), which is
 * what made an app expensive on canvas-frame: a window painted at every camera step.
 *
 *   node e2e/awake-canvas.mjs <deck folder> [cards] [apps] [documents]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const AWAKE_CANVAS = "awake";
export const CELL = { w: 1400, h: 1000 };

const WORDS = "the agent keeps a value for each square and moves toward the larger one until the cake is found reward state action return episode model policy step".split(" ");

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

/** A card as `decks card create` writes one: a title, a few paragraphs, a list and a small table; 1,000 × 700. */
const card = (n, words) => `<title>Awake card ${n}</title>
<meta name="card" content='{"w":1000,"h":700}' />
<style>
	.doc { padding: 36px 44px; font-size: 17px; line-height: 1.5 }
	table { border-collapse: collapse; width: 100% } td, th { border-bottom: 1px solid #ddd; padding: 6px 8px; text-align: left }
</style>
<div class="doc" data-id="doc">
<h1>Card ${n}: ${words(6)}</h1>
<p>${words(28)}</p>
<ul><li>${words(5)}</li><li>${words(6)}</li><li>${words(4)}</li></ul>
<table><tr><th>step</th><th>reward</th><th>value</th></tr><tr><td>1</td><td>0</td><td>${(n % 7) / 10}</td></tr><tr><td>2</td><td>1</td><td>${(n % 9) / 10}</td></tr></table>
<p>${words(22)}</p>
</div>
`;

/** A static app whose page animates: a clock redrawn ten times a second, and a counter it keeps in storage. */
const app = (n) => `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<title>Awake app ${n}</title>
	<script src="decks-storage.js"></script>
	<style>
		:root { color-scheme: light dark; font-family: system-ui, sans-serif }
		body { margin: 0; padding: 24px; line-height: 1.5 }
		#clock { font-size: 48px; font-variant-numeric: tabular-nums }
		#bar { height: 12px; background: #3b5cf6; border-radius: 6px; width: 0 }
		button { min-height: 44px; padding: 0 16px; font: inherit }
	</style>
</head>
<body>
	<h1>App ${n}</h1>
	<div id="clock">0.0</div>
	<div id="bar"></div>
	<p><button id="press" type="button">Press</button> <span id="count">Pressed 0 times</span></p>
	<script>
		let count = Number(localStorage.getItem("count") || 0);
		const show = () => (document.getElementById("count").textContent = "Pressed " + count + " times");
		show();
		document.getElementById("press").addEventListener("click", () => { count++; localStorage.setItem("count", String(count)); show(); });
		const t0 = performance.now();
		setInterval(() => {
			const s = (performance.now() - t0) / 1000;
			document.getElementById("clock").textContent = s.toFixed(1);
			document.getElementById("bar").style.width = ((s * 10) % 100) + "%";
		}, 100);
	</script>
</body>
</html>
`;

const doc = (n, words) => `# Document ${n}\n\n${words(30)}\n\n## Notes\n\n- ${words(6)}\n- ${words(7)}\n\n${words(40)}\n`;

/** The canvas, its cards, apps and documents: `{ pen, cards, apps, documents }`. */
export function awakeCanvas({ cards = 100, apps = 8, documents = 4, prefix = "awake" } = {}) {
	const options = { prefix };
	const rand = random(20261031);
	const pick = (list) => list[Math.floor(rand() * list.length)];
	const words = (n) => Array.from({ length: n }, () => pick(WORDS)).join(" ");
	const total = cards + apps + documents;
	const across = Math.ceil(Math.sqrt(total * (CELL.h / CELL.w)));
	// Dealt out so apps and documents are spread through the cards, not bunched at the end.
	const kinds = [];
	let c = 0;
	let a = 0;
	let d = 0;
	for (let i = 0; i < total; i++) {
		const want = (k, made, of) => of > 0 && made / of <= (i + 1) / total - 1e-9 && made < of;
		if (want("app", a, apps) && (i + 1) % 4 === 0) kinds.push("app"), a++;
		else if (want("document", d, documents) && (i + 1) % 8 === 0) kinds.push("document"), d++;
		else if (c < cards) kinds.push("card"), c++;
		else if (a < apps) kinds.push("app"), a++;
		else kinds.push("document"), d++;
	}
	const children = [];
	const cardFiles = [];
	const appFiles = [];
	const docFiles = [];
	// Centred on the origin: the page's first view is the middle of the grid.
	const down = Math.ceil(total / across);
	kinds.forEach((kind, i) => {
		const ox = ((i % across) - across / 2) * CELL.w;
		const oy = (Math.floor(i / across) - down / 2) * CELL.h;
		if (kind === "card") {
			const n = cardFiles.length;
			const name = `awake-${String(n).padStart(3, "0")}`;
			const path = `cards/${name}/index.html`;
			cardFiles.push({ name, html: card(n, words) });
			children.push({ type: "browser", id: `ac${n}`, name: `Awake card ${n}`, url: path, width: 1000, height: 700, metadata: { type: "decks.card", path }, x: ox + 40, y: oy + 40 });
		} else if (kind === "app") {
			const n = appFiles.length;
			const name = `${options.prefix ?? "awake"}-app-${n}`;
			appFiles.push({ name, html: app(n) });
			children.push({ type: "browser", id: `aa${n}`, name: `Awake app ${n}`, url: `apps/${name}/`, width: 1100, height: 760, metadata: { type: "decks.app", name }, x: ox + 40, y: oy + 40 });
		} else {
			const n = docFiles.length;
			const path = `docs/${prefix}-${n}.md`;
			docFiles.push({ path, text: doc(n, words) });
			children.push({ type: "browser", id: `ad${n}`, name: `Awake document ${n}`, url: path, width: 1000, height: 700, metadata: { type: "decks.document", path }, x: ox + 40, y: oy + 40 });
		}
		// Two notes beside each item, so the sheet paints too.
		for (let k = 0; k < 2; k++) children.push({ type: "note", id: `an${i}-${k}`, width: 220, metadata: { type: "decks.markdown" }, content: `**${words(2)}** ${words(10 + Math.floor(rand() * 8))}`, x: ox + 1140, y: oy + 60 + k * 300 });
	});
	return { pen: { version: "2.14", children }, cards: cardFiles, apps: appFiles, documents: docFiles, across, down };
}

/** Write the canvas into `deck`: `canvases/awake/`, its cards, the apps in `apps/`, the documents in `docs/`. */
export function writeAwakeCanvas(deck, options = {}) {
	const made = awakeCanvas(options);
	const name = options.name ?? AWAKE_CANVAS;
	const folder = join(deck, "canvases", name);
	for (const { name, html } of made.cards) {
		mkdirSync(join(folder, "cards", name), { recursive: true });
		writeFileSync(join(folder, "cards", name, "index.html"), html);
	}
	for (const { name, html } of made.apps) {
		mkdirSync(join(deck, "apps", name), { recursive: true });
		writeFileSync(join(deck, "apps", name, "index.html"), html);
		writeFileSync(join(deck, "apps", name, "app.json"), `${JSON.stringify({ title: `Awake app ${name.split("-").pop()}`, kind: "static" })}\n`);
	}
	mkdirSync(join(deck, "docs"), { recursive: true });
	for (const { path, text } of made.documents) writeFileSync(join(deck, path), text);
	writeFileSync(join(folder, "canvas.json"), `${JSON.stringify({ title: name === AWAKE_CANVAS ? "Awake" : name })}\n`);
	writeFileSync(join(folder, "canvas.pen"), JSON.stringify(made.pen));
	return { folder, cards: made.cards.length, apps: made.apps.length, documents: made.documents.length, across: made.across, down: made.down };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const [deck, cards, apps, documents] = process.argv.slice(2);
	if (!deck) {
		console.error("usage: node e2e/awake-canvas.mjs <deck folder> [cards] [apps] [documents]");
		process.exit(2);
	}
	console.log(JSON.stringify(writeAwakeCanvas(resolve(deck), { cards: Number(cards ?? 100), apps: Number(apps ?? 8), documents: Number(documents ?? 4) })));
}
