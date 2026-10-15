// The C++ picker against today's picking, in headless Chromium (the reference asks the canvas
// whether a point is on a path): saved stages and made-up drawings full of paths and arrows.
// node packages/engine/test/pick-diff.mjs  (PLAYWRIGHT_BROWSERS_PATH must point at the browsers)
import http from "node:http";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const bundle = await build({ entryPoints: [join(here, "pick-page.ts")], bundle: true, format: "esm", write: false, outdir: "out", loader: { ".wasm": "file" }, external: ["node:*"], logLevel: "silent" });
const js = bundle.outputFiles.find((f) => f.path.endsWith(".js")).text;
const wasm = readFileSync(join(here, "..", "wasm", "scene.wasm"));
const server = http.createServer((req, res) => {
	if (req.url === "/") return res.writeHead(200, { "content-type": "text/html" }), res.end('<!doctype html><body><script type="module" src="/page.js"></script>');
	if (req.url === "/page.js") return res.writeHead(200, { "content-type": "text/javascript" }), res.end(js);
	if (req.url.endsWith(".wasm")) return res.writeHead(200, { "content-type": "application/wasm" }), res.end(wasm);
	res.writeHead(404).end();
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));

const saved = [];
for (const file of execSync("find /home/decks/data/decks /mnt/data/decks-data/worktrees -name '*.pen' -not -path '*/node_modules/*'", { encoding: "utf8" }).split("\n").filter(Boolean)) {
	try {
		saved.push(JSON.parse(readFileSync(file, "utf8")));
	} catch {}
}
let seed = 7;
const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = (list) => list[Math.floor(rand() * list.length)];
const n = (k = 300) => Math.round(rand() * k * 10) / 10;
const geometry = () =>
	pick([
		() => `M${n()} ${n()} L${n()} ${n()}`,
		() => `M${n()} ${n()} C${n()} ${n()} ${n()} ${n()} ${n()} ${n()}`,
		() => `M${n()},${n()}Q${n()},${n()} ${n()},${n()}T${n()},${n()}`,
		() => `M${n()} ${n()} l${n(80)} ${n(80)} h${n(50)} v${n(50)} z`,
		() => `M10 80 A 45 45, 0, 0, 0, 125 125 L 125 80 Z`,
		() => `M${n()} ${n()} a${n(60)} ${n(40)} ${n(90)} 1 0 ${n(100)} ${n(100)}`,
		() => `M0 0 a5 5 0 01 10 10`,
		() => `m10 10 c20 0 20 20 40 20 s20 -20 40 -20`,
		() => `M0 0 L100 0 L100 100 L0 100 Z M25 25 L75 25 L75 75 L25 75 Z`,
		() => `bogus`,
	])();
let next = 0;
const made = [];
for (let d = 0; d < 60; d++) {
	const children = [];
	for (let i = 0; i < 25; i++) {
		const type = pick(["path", "path", "path", "rectangle", "group", "ellipse", "text"]);
		const node = { type, id: `p${next++}`, x: n(1200), y: n(800) };
		if (type === "path") {
			node.geometry = geometry();
			if (rand() < 0.5) node.viewBox = [0, 0, 100 + n(200), 100 + n(200)];
			if (rand() < 0.7) node.width = 20 + n(400);
			if (rand() < 0.7) node.height = 20 + n(400);
			if (rand() < 0.4) node.fill = "#88aaff";
			if (rand() < 0.6) { node.stroke = "#000"; node.strokeWidth = pick([1, 2, 6, 20]); }
		}
		if (type === "group") node.children = [{ type: "rectangle", id: `p${next++}`, x: n(50), y: n(50), width: 40, height: 30 }, { type: "path", id: `p${next++}`, geometry: geometry(), x: n(50), y: n(50) }];
		if (type === "text") node.content = "Some words";
		children.push(node);
	}
	made.push({ version: "2.6", children });
}

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForFunction(() => typeof window.run === "function");
const result = await page.evaluate(({ docs }) => window.run(docs, 11), { docs: [...saved, ...made] });
const { examples, ...counts } = result;
console.log(JSON.stringify(counts));
for (const one of examples) console.log("  far from the edge:", JSON.stringify(one).slice(0, 300));
if (errors.length) console.log(errors.join("\n"));
/*
 * The bar: every marquee the same; no press the canvas takes and C++ misses, unless it is within 2
 * screen pixels of the edge of the line's reach; and at most 1 in 10,000 presses C++ takes beyond
 * that, which is where a line far wider than its own bends leaves holes in the browser's stroke.
 */
const ok = !errors.length && result.marqueeDiffer === 0 && result.farMissed === 0 && result.farFromEdge <= result.presses / 10000 && result.sentAgain === 0;
console.log(ok ? "pick-diff: passed" : "pick-diff: FAILED");
await browser.close();
server.close();
process.exit(ok ? 0 : 1);
