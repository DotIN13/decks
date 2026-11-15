#!/usr/bin/env node
// The six fixture drawings as the browser's engine draws them: the committed pkg/ (what the web
// app ships) in Chromium on WebGPU, its page engine and worker engine run the way the canvas runs
// them, read back over white. Writes goldens/<name>.png and goldens/<name>.view.json (the view).
// Heavy: run it through tools/heavy.mjs. Port 4740.
import { createServer } from "node:http";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const STAGE = resolve(HERE, "../../..");
const DRAWINGS = resolve(STAGE, "../../tools/fixtures/drawings");
const GOLDENS = resolve(HERE, "../goldens");
const PORT = 4740;
// The engine's fixture fonts (stage_paint::fixtures::FONTS), as the Rust test adds them.
const FONTS = [
	["Inter", "inter_latest_latin-400-normal.ttf", false],
	["Inter", "inter_latest_latin-700-normal.ttf", false],
	["Inter", "inter_latest_latin-600-normal.ttf", false],
	["Inter", "inter_latest_latin-400-italic.ttf", false],
	["Noto Sans SC", "noto-sans-sc_latest_chinese-simplified-400-normal.ttf", true],
	["JetBrains Mono", "jetbrains-mono_latest_latin-400-normal.ttf", false],
];
// The view: the drawing's extent with this margin, at zoom 1, two pixels a point.
const MARGIN = 24;
const DPR = 2;

const PAGE = `<!doctype html><canvas id="c"></canvas><script type="module">
import init, * as m from "/pkg/stage_web.js";
window.draw = async (pen, fonts, margin, dpr) => {
	await init();
	const page = new m.PageEngine(pen, false, "golden");
	const worker = new m.WorkerEngine(pen, false);
	for (const [family, url, fallback] of fonts) {
		const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
		page.addFont(family, bytes, fallback);
		worker.addFont(family, bytes, fallback);
	}
	const [ex, ey, ew, eh] = JSON.parse(page.extent());
	const view = { x: Math.floor(ex) - margin, y: Math.floor(ey) - margin, zoom: 1, scale: dpr, width: Math.ceil(ew) + 2 * margin, height: Math.ceil(eh) + 2 * margin };
	const W = view.width * dpr, H = view.height * dpr;
	const tile = m.WorkerEngine.tileSize();
	const off = new OffscreenCanvas(tile, tile);
	worker.setGpu(await m.openOffscreen(off, tile, tile, "webgpu", false), off);
	const canvas = document.getElementById("c");
	canvas.width = W; canvas.height = H;
	page.setGpu(await m.openCanvas(canvas, W, H, "webgpu", false));
	const args = [view.x, view.y, view.zoom, dpr, view.width, view.height];
	for (let round = 0; round < 64; round++) {
		for (const t of worker.paint(...args, false, 64)) page.putTile(t.scale, t.x, t.y, t.bitmap);
		if (worker.viewLeft(...args, false) === 0) break;
	}
	page.frame(...args, m.scaleFor(dpr, false));
	const flat = document.createElement("canvas");
	flat.width = W; flat.height = H;
	const g = flat.getContext("2d");
	g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
	g.drawImage(canvas, 0, 0);
	return { view, png: flat.toDataURL("image/png") };
};
</script>`;

const TYPES = { ".js": "text/javascript", ".wasm": "application/wasm", ".ttf": "font/ttf", ".html": "text/html" };
const server = createServer(async (req, res) => {
	try {
		const path = new URL(req.url, "http://x").pathname;
		if (path === "/") return void res.writeHead(200, { "content-type": "text/html" }).end(PAGE);
		const file = path.startsWith("/pkg/") ? join(STAGE, path) : join(STAGE, "fonts", path.slice(1));
		res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(await readFile(file));
	} catch {
		res.writeHead(404).end();
	}
});
await new Promise((ok) => server.listen(PORT, "127.0.0.1", ok));
async function drawAll(browser) {
	let failed = 0;
	const page = await browser.newPage();
	page.on("pageerror", (e) => console.error("page:", e.message));
	await page.goto(`http://127.0.0.1:${PORT}/`);
	const names = (await readdir(DRAWINGS)).filter((f) => f.endsWith(".pen")).map((f) => f.slice(0, -4));
	for (const name of names) {
		const pen = await readFile(join(DRAWINGS, `${name}.pen`), "utf8");
		const fonts = FONTS.map(([family, file, fallback]) => [family, `/${file}`, fallback]);
		try {
			const { view, png } = await page.evaluate(({ pen, fonts, m, d }) => window.draw(pen, fonts, m, d), { pen, fonts, m: MARGIN, d: DPR });
			await writeFile(join(GOLDENS, `${name}.png`), Buffer.from(png.split(",")[1], "base64"));
			await writeFile(join(GOLDENS, `${name}.view.json`), JSON.stringify(view, null, "\t") + "\n");
			console.log(`${name}: ${view.width * DPR}×${view.height * DPR}`);
		} catch (e) {
			failed++;
			console.error(`${name}: ${e.message}`);
		}
	}
	return failed;
}

const browser = await chromium.launch({ args: ["--enable-unsafe-webgpu", "--use-angle=metal"] });
try {
	process.exitCode = (await drawAll(browser)) ? 1 : 0;
} finally {
	await browser.close();
	server.close();
}
