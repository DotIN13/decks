// Runs the engine in headless Chromium on WebGPU and on WebGL 2, checks pixels and measures memory.
// node packages/engine/test/run.mjs  (PLAYWRIGHT_BROWSERS_PATH must point at the browsers)
import http from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const bundle = await build({ entryPoints: [join(here, "page.ts")], bundle: true, format: "esm", write: false, outdir: "out", loader: { ".wasm": "file" }, logLevel: "silent" });
const js = bundle.outputFiles.find((f) => f.path.endsWith(".js")).text;
const wasm = readFileSync(join(here, "..", "wasm", "engine.wasm"));
const server = http.createServer((req, res) => {
	if (req.url === "/") return res.writeHead(200, { "content-type": "text/html" }), res.end('<!doctype html><body style="margin:0;background:#fff"><div id="host"></div><script type="module" src="/page.js"></script>');
	if (req.url === "/page.js") return res.writeHead(200, { "content-type": "text/javascript" }), res.end(js);
	if (req.url.endsWith(".wasm")) return res.writeHead(200, { "content-type": "application/wasm" }), res.end(wasm);
	res.writeHead(404).end();
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const url = `http://127.0.0.1:${server.address().port}/`;

/** The colours at some points of a screenshot, read by the browser's own decoder. */
async function pixelsOf(page, points) {
	const shot = (await page.screenshot()).toString("base64");
	const colours = await page.evaluate(async ({ shot, points }) => {
		const image = new Image();
		image.src = `data:image/png;base64,${shot}`;
		await image.decode();
		const canvas = new OffscreenCanvas(image.width, image.height);
		const ctx = canvas.getContext("2d");
		ctx.drawImage(image, 0, 0);
		return points.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data.slice(0, 3)]);
	}, { shot, points });
	const byPoint = new Map(points.map((p, i) => [p.join(","), colours[i]]));
	return (x, y) => byPoint.get(`${x},${y}`) ?? [0, 0, 0];
}

let failed = 0;
const say = (name, ok, detail = "") => {
	if (!ok) failed++;
	console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};
const pss = (pid) => {
	try {
		return +readFileSync(`/proc/${pid}/smaps_rollup`, "utf8").match(/^Pss:\s+(\d+)/m)[1] / 1024;
	} catch {
		return 0;
	}
};

for (const prefer of ["webgpu", "webgl2"]) {
	// Without these, headless Chrome on a machine with no GPU destroys a device the moment it
	// configures a WebGPU canvas; with them, SwiftShader backs both WebGPU and the compositor.
	const browser = await chromium.launch({ args: ["--enable-unsafe-webgpu", "--use-webgpu-adapter=swiftshader", "--disable-gpu-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-features=Vulkan", "--use-vulkan=swiftshader", "--enable-unsafe-swiftshader"] });
	const page = await browser.newPage({ viewport: { width: 800, height: 500 }, deviceScaleFactor: 1 });
	const errors = [];
	page.on("pageerror", (e) => errors.push(String(e)));
	page.on("console", (m) => { if (m.type() === "error") { errors.push(m.text()); console.log("  console:", m.text().slice(0, 300)); } });
	await page.goto(url);
	await page.waitForFunction(() => !!window.t);
	const backend = await page.evaluate((p) => window.t.start(p, 800, 500, 1), prefer);
	say(`${prefer}: the engine starts on it`, backend === prefer, String(backend));
	if (backend !== prefer) {
		await browser.close();
		continue;
	}
	// A red square under the page, a green picture under it too, a yellow outline over the blue page.
	await page.evaluate(async () => {
		const e = window.t.engine;
		e.set("red", { layer: 0, order: 1, x: 20, y: 20, w: 100, h: 100, color: [255, 0, 0, 1] });
		await window.t.picture("green", 64, 64, 120, 0);
		e.set("pic", { layer: 0, order: 2, x: 140, y: 20, w: 128, h: 128, texture: "green", radius: 16 });
		e.set("ring", { layer: 1, order: 1, x: 300, y: 100, w: 200, h: 150, color: [255, 255, 0, 1], stroke: 6 });
		e.set("note", { layer: 1, order: 2, x: 420, y: 200, w: 60, h: 40, color: [0, 0, 0, 1] });
		e.render(true);
		await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
	});
	// Each layer read back from the graphics card, so WebGPU is checked where headless Chrome cannot show it.
	const read = (layer, points) => page.evaluate(({ layer, points }) => window.t.engine.readPixels(layer, points), { layer, points });
	const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 40);
	const [red, pic, corner] = await read(0, [[70, 70], [200, 80], [141, 21]]);
	say(`${prefer}: a colour rectangle is drawn`, near(red, [255, 0, 0, 255]), red.join(","));
	say(`${prefer}: a picture is drawn from its texture`, pic[1] > 150 && pic[0] < 100 && pic[3] > 240, pic.join(","));
	say(`${prefer}: its corner is rounded`, corner[3] < 60, corner.join(","));
	const [ring, hole, note] = await read(1, [[302, 175], [350, 150], [450, 220]]);
	say(`${prefer}: an outline is drawn as an outline`, near(ring, [255, 255, 0, 255]) && hole[3] === 0, `${ring} / ${hole}`);
	say(`${prefer}: a note on the over layer covers what is under it`, near(note, [0, 0, 0, 255]), note.join(","));
	{
		const pixel = await pixelsOf(page, [[350, 150], [302, 175], [70, 70]]);
		say(`${prefer}: on screen, the page shows between the two layers`, near(pixel(350, 150), [0, 0, 255]) && near(pixel(302, 175), [255, 255, 0]) && near(pixel(70, 70), [255, 0, 0]), `${pixel(350, 150)} ${pixel(302, 175)} ${pixel(70, 70)}`);
	}
	// The camera moves everything, and nothing is drawn again unless something changed.
	const moved = await page.evaluate(async () => {
		const e = window.t.engine;
		e.camera(400 + 100, 250, 1);
		const first = e.render();
		const second = e.render();
		await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
		return { first, second };
	});
	say(`${prefer}: a camera move redraws both layers`, moved.first[0] >= 0 && moved.first[1] >= 0, JSON.stringify(moved.first));
	say(`${prefer}: and a frame with no change draws nothing`, moved.second[0] === -1 && moved.second[1] === -1, JSON.stringify(moved.second));
	const [moved1, moved2] = await read(0, [[10, 70], [30, 70]]);
	say(`${prefer}: the red square moved left by the camera's 100 px`, near(moved1, [255, 0, 0, 255]) && moved2[3] === 0, `${moved1} / ${moved2}`);
	say(`${prefer}: no page errors`, errors.length === 0, errors.join(" | ").slice(0, 300));

	// Memory: a 1600 x 1000 window at 2x with 300 board pictures from 40 textures of 960 x 540.
	const big = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
	await big.goto(url);
	await big.waitForFunction(() => !!window.t);
	const cdp = await browser.newBrowserCDPSession();
	const total = async () => {
		const { processInfo } = await cdp.send("SystemInfo.getProcessInfo");
		return Math.round(processInfo.reduce((n, p) => n + pss(p.id), 0));
	};
	await big.waitForTimeout(1500);
	const before = await total();
	await big.evaluate(async (prefer) => {
		await window.t.start(prefer, 1600, 1000, 2);
		for (let i = 0; i < 40; i++) await window.t.picture(`p${i}`, 960, 540, (i * 37) % 360, 0);
		const e = window.t.engine;
		for (let i = 0; i < 300; i++) e.set(`b${i}`, { layer: 0, order: i, x: (i % 20) * 520, y: Math.floor(i / 20) * 360, w: 480, h: 320, texture: `p${i % 40}`, radius: 8 });
		e.camera(800, 500, 0.5);
		e.render(true);
	}, prefer);
	const steps = await big.evaluate(async () => {
		const e = window.t.engine;
		const times = [];
		for (let i = 0; i < 60; i++) {
			const t0 = performance.now();
			e.camera(800 + i * 40, 500 + i * 10, 0.5);
			e.render();
			times.push(performance.now() - t0);
			await new Promise((ok) => requestAnimationFrame(ok));
		}
		times.sort((a, b) => a - b);
		return { median: times[30], worst: times[59], bytes: e.textureBytes() };
	});
	await big.waitForTimeout(2000);
	const after = await total();
	console.log(`MEMORY ${prefer}: tab ${after} MB with the engine and 300 pictures, ${before} MB before; pictures ${Math.round(steps.bytes / 1048576)} MB; pan step ${steps.median.toFixed(2)} ms median, ${steps.worst.toFixed(2)} worst (page time, at 1600 x 1000, 2x)`);
	await browser.close();
}
server.close();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
