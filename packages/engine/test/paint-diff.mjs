// The C++ painter against CanvasKit painting the same tile through the app's `paint.ts`: random
// drawings of what the painter draws so far, in light and dark, at several zooms.
// node packages/engine/test/paint-diff.mjs [count]   (PLAYWRIGHT_BROWSERS_PATH must point at the browsers)
import http from "node:http";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const bundle = await build({ entryPoints: [join(here, "paint-page.ts")], bundle: true, format: "esm", write: false, outdir: "out", external: ["node:*", "fs", "path", "crypto"], loader: { ".wasm": "file" }, logLevel: "silent" });
const js = bundle.outputFiles.find((f) => f.path.endsWith(".js")).text;
const files = { "/scene.wasm": readFileSync(join(here, "..", "wasm", "scene.wasm")), "/canvaskit.wasm": readFileSync(join(root, "node_modules/canvaskit-wasm/bin/canvaskit.wasm")) };
// The fonts `text-diff.mjs` uses (_scratch/fonts), for words.
const fontDir = join(root, "_scratch", "fonts");
const fontFiles = readdirSync(fontDir).filter((f) => f.endsWith(".ttf")).sort();
const server = http.createServer((req, res) => {
	if (req.url === "/fonts/") return res.writeHead(200, { "content-type": "application/json" }), res.end(JSON.stringify(fontFiles));
	if (req.url.startsWith("/fonts/")) return res.writeHead(200, { "content-type": "font/ttf" }), res.end(readFileSync(join(fontDir, decodeURIComponent(req.url.slice(7)))));
	if (req.url === "/") return res.writeHead(200, { "content-type": "text/html" }), res.end('<!doctype html><body><script type="module" src="/page.js"></script>');
	if (req.url === "/page.js") return res.writeHead(200, { "content-type": "text/javascript" }), res.end(js);
	const file = Object.entries(files).find(([name]) => req.url.endsWith(name.slice(1)));
	if (file) return res.writeHead(200, { "content-type": "application/wasm" }), res.end(file[1]);
	res.writeHead(404).end();
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));

let seed = Number(process.env.SEED ?? 9);
const seed0 = seed;
// mulberry32: the old (seed * 1103515245) lost bits past 2^53 and repeated every three drawings.
const rand = () => {
	seed = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (list) => list[Math.floor(rand() * list.length)];
const hex = () => "#" + Array.from({ length: 3 }, () => Math.floor(rand() * 256).toString(16).padStart(2, "0")).join("") + pick(["", "", "80", "cc"]);
const WORDS = [
	"Hello",
	"The quick brown fox jumps over the lazy dog",
	"Ship the C++ painter, then drop CanvasKit.",
	"Łódź naïve café — 3.14 × 2",
	"Two lines\nof words",
	"A long label that wraps across several lines when its box is narrow enough to need it",
	"WAVE AVA fi fl 10:30",
	"中文 mixed with English",
	"→ ✓ ★ arrows and ticks",
];
const CARDS = [
	"# A heading\n\nSome **bold** and *italic* words, with `code` and a [link](https://example.com).",
	"- one\n- two with ~~strike~~\n  - nested ==mark==\n- [ ] a task\n- [x] done",
	"1. first\n2. second\n\n> A quote that goes on long enough to wrap across a line or two.",
	"> [!note] Callout\n> With words inside.\n\n---\n\nAfter a rule.",
	"```js\nconst x = 1; // a comment\nfunction f(a) { return a * 2; }\n```",
	"| Name | Value |\n| --- | ---: |\n| apples | 3 |\n| a much longer row of words | 42 |",
	"### Small heading\n\n[red words]{.red} and [large]{.large} and a footnote[^1].\n\n[^1]: The note itself.",
	"Plain words in a card, nothing else: the most common kind.",
	"| a | b | c | d | e | f |\n| --- | --- | --- | --- | --- | --- |\n| wide table that has to scroll sideways because it has so many columns | 2 | 3 | 4 | 5 | 6 |",
];
let next = 0;
const GEOMETRY = [
	"M4 16 L104 16 M84 28 L104 16 L84 4",
	"M10 80 C 40 10, 65 10, 95 80 S 150 150, 180 80",
	"M10 10 Q 50 90 90 10 T 170 10",
	"M50 0 L61 35 L98 35 L68 57 L79 91 L50 70 L21 91 L32 57 L2 35 L39 35 Z",
	"M10 50 a 40 25 0 1 0 80 0 a 40 25 0 1 0 -80 0 Z M30 50 h40 v20 h-40 z",
	"M0 0 h60 v60 h-60 z m15 15 v30 h30 v-30 z",
	"M5 70 L40 10 L75 70",
	"M20 20 A 30 50 -45 0 1 80 80",
	"M10 10 L90 90 M90 10 L10 90",
	"m10 40 c 20 -40 40 40 60 0 s 40 -40 60 0",
];
const shape = (depth) => {
	const type = pick(depth > 1 ? ["rectangle", "ellipse", "rectangle", "polygon", "path", "text"] : ["rectangle", "rectangle", "frame", "ellipse", "group", "note", "polygon", "path", "path", "text", "text", "note", "prompt", "browser"]);
	const node = { type, id: `s${next++}`, x: Math.round(rand() * 360 - 40), y: Math.round(rand() * 360 - 40), width: 20 + Math.round(rand() * 220), height: 20 + Math.round(rand() * 220) };
	if (type !== "group" && type !== "note" && rand() < 0.85) node.fill = rand() < 0.15 ? [hex(), hex()] : hex();
	if (type === "rectangle" || type === "frame") {
		if (rand() < 0.6) node.cornerRadius = rand() < 0.3 ? [0, 8, 24, 4].map(() => Math.round(rand() * 40)) : Math.round(rand() * 40);
	}
	if (type !== "group" && type !== "note" && rand() < 0.5) {
		node.stroke = { fill: hex(), thickness: rand() < 0.2 ? { top: 2, right: 0, bottom: 6, left: 0 } : pick([1, 2, 3, 6, 10]), align: pick(["inside", "center", "outside"]) };
	}
	if (type !== "group" && rand() < 0.3) node.effect = { type: "shadow", color: pick(["#00000040", "#ff000080", "#0000ff60"]), blur: pick([0, 4, 10, 24]), offset: { x: pick([0, 3, -5]), y: pick([0, 4, 8]) } };
	if (rand() < 0.2) node.opacity = pick([0.3, 0.6, 0.9]);
	if (rand() < 0.2) node.rotation = pick([15, 45, -30, 90]);
	if (rand() < 0.1) node.flipX = true;
	if (type === "frame") {
		node.layout = "none";
		node.clip = rand() < 0.6;
		node.children = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => shape(depth + 1));
	}
	if (type === "ellipse" && rand() < 0.4) {
		if (rand() < 0.5) node.innerRadius = pick([0.3, 0.6, 0.85]);
		if (rand() < 0.7) node.sweepAngle = pick([90, 200, -120, 300]);
		if (rand() < 0.5) node.startAngle = pick([0, 30, 135, -60]);
	}
	if (type === "polygon") {
		node.polygonCount = pick([3, 5, 6, 8]);
		if (rand() < 0.4) node.cornerRadius = pick([4, 12, 30]);
		if (node.stroke && typeof node.stroke.thickness === "object") node.stroke.thickness = 3;
	}
	if (type === "path") {
		node.geometry = pick(GEOMETRY);
		if (rand() < 0.7) node.viewBox = [0, 0, pick([100, 108, 180]), pick([32, 90, 100])];
		if (rand() < 0.3) node.fillRule = "evenodd";
		if (rand() < 0.5) delete node.fill;
		if (rand() < 0.7) node.stroke = { fill: hex(), thickness: pick([1, 2, 4, 8]), align: pick(["inside", "center", "outside", "center"]) };
		if (rand() < 0.3) node.metadata = { type: "decks.arrow", dash: rand() < 0.5, ...(rand() < 0.5 ? { label: pick(["yes", "then", "A longer label on the arrow"]) } : {}) };
	}
	if (node.stroke && typeof node.stroke.thickness !== "object") {
		if (rand() < 0.4) node.strokeLinecap = pick(["round", "square", "butt"]);
		if (rand() < 0.4) node.strokeLinejoin = pick(["round", "bevel", "miter"]);
		if (rand() < 0.25 && type !== "note") node.strokeDash = pick(["dashed", "dotted"]);
	}
	if (type === "group") node.children = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => shape(depth + 1));
	if (type === "note" || type === "prompt") node.content = rand() < 0.3 ? "" : pick(WORDS);
	if (type === "prompt" && rand() < 0.7) node.model = pick(["claude-opus-5-5", "gpt-6"]);
	if (type === "browser") node.url = "https://example.com/a/page";
	if (type === "rectangle" && depth === 0 && rand() < 0.15) {
		node.metadata = { type: "decks.media", kind: pick(["audio", "video"]), file: "assets/clip.mp3", ...(rand() < 0.7 ? { seconds: pick([7, 95, 3725]) } : {}), ...(rand() < 0.5 ? { peaks: Array.from({ length: 40 }, () => Math.round(rand() * 100) / 100) } : {}) };
		node.width = Math.max(node.width, 120);
		node.height = Math.max(node.height, 60);
	}
	// Half the notes are markdown cards, as most on a real stage are.
	if (type === "note" && rand() < 0.5) {
		node.metadata = { type: "decks.markdown" };
		node.content = pick(CARDS);
	}
	if (type === "text") {
		node.content = pick(WORDS);
		if (rand() < 0.25) {
			node.metadata = { type: "decks.markdown" };
			node.content = pick(CARDS);
		}
		delete node.stroke;
		delete node.effect;
		node.fontFamily = pick(["Inter", "Inter", "JetBrains Mono", "Lora"]);
		node.fontSize = pick([11, 13, 14, 17, 22, 31]);
		if (rand() < 0.4) node.fontWeight = pick([600, 700]);
		if (rand() < 0.2) node.fontStyle = "italic";
		if (rand() < 0.2) node.letterSpacing = pick([-0.3, 0.5, 1]);
		if (rand() < 0.3) node.lineHeight = pick([1.2, 1.5]);
		if (rand() < 0.3) node.textAlign = pick(["center", "right"]);
		if (rand() < 0.5) node.textGrowth = "fixed-width";
		else {
			delete node.width;
			delete node.height;
		}
		if (rand() < 0.2) node.textAlignVertical = pick(["middle", "bottom"]);
		if (rand() < 0.15) node.underline = true;
		if (rand() < 0.1) node.strikethrough = true;
		if (typeof node.fill !== "string") node.fill = hex();
	}
	return node;
};

const browser = await chromium.launch({ dumpio: !!process.env.DUMPIO, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => (m.type() === "error" ? errors.push(m.text()) : process.env.DEBUG && console.log("page:", m.text())));
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForFunction(() => typeof window.compare === "function");
const count = Number(process.argv[2] ?? 200);
const whys = new Map();
let painted = 0, fallback = 0, bad = 0, saved = 0, wrong = 0, misplacedWorst = 0;
const worstList = [];
for (let i = 0; i < count; i++) {
	next = 0;
	let doc = { version: "2.6", children: Array.from({ length: 1 + Math.floor(rand() * 6) }, () => shape(0)) };
	const level = pick([0.5, 1, 1, 2]);
	const pixels = 256;
	const size = pixels / level;
	let tile = { x: Math.round(rand() * 200 - 100), y: Math.round(rand() * 200 - 100), size };
	let scheme = pick(["light", "dark"]);
	// CASE=<file.json> replays one saved case; CASES=<a.json,b.json,...> several, one per tile, in order.
	if (process.env.CASE) ({ doc, tile, scheme } = JSON.parse(readFileSync(process.env.CASE, "utf8")));
	if (process.env.CASES) ({ doc, tile, scheme } = JSON.parse(readFileSync(process.env.CASES.split(",")[i], "utf8")));
	// START=n skips the cases before it (still drawn at random, so the rest are the same).
	if (i < Number(process.env.START ?? 0)) continue;
	// The case being run, kept so a crash of the page leaves it to replay.
	writeFileSync("/tmp/paint-current.json", JSON.stringify({ i, doc, tile, scheme }));
	const r = await page.evaluate(({ doc, tile, scheme, pixels, dumping }) => window.compare(doc, tile, scheme, pixels, dumping), { doc, tile, scheme, pixels, dumping: !!process.env.DUMP });
	if (process.env.HEAP && i % 10 === 0) console.log(`case ${i}: engine heap ${(r.heap / 1048576).toFixed(0)} MB, CanvasKit ${(r.ckHeap / 1048576).toFixed(0)} MB, JS ${(r.jsHeap / 1048576).toFixed(0)} MB`);
	if (!r.drawn) {
		fallback++;
		whys.set(r.why ?? "?", (whys.get(r.why ?? "?") ?? 0) + 1);
		continue;
	}
	// DUMP=<file> writes both pictures' raw pixels, for working out a difference by hand.
	if (process.env.DUMP && r.want) writeFileSync(process.env.DUMP, JSON.stringify({ want: r.want, got: r.got }));
	painted++;
	worstList.push(r.differ / r.pixels);
	misplacedWorst = Math.max(misplacedWorst, r.misplaced / r.pixels);
	// The bar: no more than 0.05% of a tile misplaced (wrong even a pixel away).
	if (r.misplaced / r.pixels > 0.0005) wrong++;
	const over = r.differ / r.pixels > 0.002 || r.misplaced / r.pixels > 0.0005;
	if (over) bad++;
	// A replayed case is always saved, to look at.
	if ((over || process.env.CASE) && r.want) {
		if (saved < 3) {
			saved++;
			const name = `/tmp/paint-diff-${i}`;
			writeFileSync(`${name}.json`, JSON.stringify({ doc, tile, scheme, differ: r.differ, worst: r.worst }));
			const toPpm = (data) => Buffer.concat([Buffer.from(`P6 ${pixels} ${pixels} 255\n`), Buffer.from(Array.from({ length: pixels * pixels }, (_, p) => [0, 1, 2].map((c) => Math.round((data[p * 4 + c] * data[p * 4 + 3] + 255 * (255 - data[p * 4 + 3])) / 255))).flat())]);
			writeFileSync(`${name}-canvaskit.ppm`, toPpm(r.want));
			writeFileSync(`${name}-cpp.ppm`, toPpm(r.got));
			console.log(`differs: case ${i}, ${r.differ} of ${r.pixels} pixels by more than 24 (worst ${r.worst}), ${r.misplaced} misplaced; saved ${name}*`);
		} else console.log(`differs: case ${i}, ${r.differ} of ${r.pixels} pixels by more than 24 (worst ${r.worst}), ${r.misplaced} misplaced`);
		// Every failing case is kept, by seed and number, for replaying (CASE=).
		writeFileSync(`/tmp/paint-case-${seed0}-${i}.json`, JSON.stringify({ doc, tile, scheme }));
	}
}
worstList.sort((a, b) => b - a);
console.log(`${count} tiles: ${painted} painted by C++, ${fallback} left to CanvasKit; ${bad} differ on more than 0.2% of pixels; the worst ${((worstList[0] ?? 0) * 100).toFixed(2)}%. ${wrong} have more than 0.05% misplaced (wrong a pixel away too); the worst ${(misplacedWorst * 100).toFixed(3)}%`);
if (errors.length) console.log(errors.slice(0, 5).join("\n"));
// What sent tiles to CanvasKit, most first.
for (const [why, n] of [...whys].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)} left to CanvasKit: ${why}`);
await browser.close();
server.close();
process.exit(wrong || errors.length ? 1 : 0);
