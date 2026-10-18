/**
 * The stage engine's pictures, the same under every backend a browser may give it.
 *
 * Draws the engine's fixtures (`stage_paint::fixtures`: hand-written draw lists, words, a card, and
 * the real stages in `packages/stage/crates/gpu/fixtures/` tiled the way the worker tiles them) with
 * the committed wasm builds, in:
 *
 * - Chromium, WebGPU (`pkg/`);
 * - Chromium with `navigator.gpu` taken away, WebGL 2 (`pkg-gl/`, ANGLE);
 * - WebKit as an iPhone 15 Pro (Playwright's descriptor: 3× screen, touch, Safari's user agent), with
 *   `navigator.gpu` taken away, WebGL 2 (`pkg-gl/`);
 *
 * each on a page of a throwaway server, laid on the engine's canvas pixel for pixel over white
 * (`Fixtures.show`) and read back from that canvas. Every picture is held to its native golden
 * (`crates/gpu/goldens/`, drawn on Metal by `cargo test -p stage-gpu`, `STAGE_UPDATE_GOLDENS=1` to
 * draw anew) and to the same picture under the other backends.
 *
 * The rule (`DELTA`, `SHARE`): no channel more than 3 off on at least 99.5% of a picture's pixels.
 * Exact equality is not the claim. On this Mac (Apple GPU; Dawn and ANGLE both on Metal) every
 * backend comes within 1 level of the goldens on every pixel: the 1s are the golden PNG's straight
 * alpha premultiplied again at soft edges (WebGPU has them too), and up to 0.5% of a stage's pixels
 * where WebGL 2 rounds a blend or a mesh's resolved samples the other way. The slack beyond that is
 * for machines this was not measured on: another GPU may place its four samples elsewhere (meshes'
 * edges are smoothed by them; shapes' edges are the shader's own and need none), and a phone short
 * of memory draws with one (not tested here: the page opens with four, as the goldens were drawn).
 * 3 levels is below what an eye sees on a flat colour; 0.5% is far below what any real fault costs
 * (a wrong blend, a missing clip, swapped channels or a premultiplication slip moves most of a
 * picture by tens of levels).
 *
 * A picture outside the rule leaves `<target>-<fixture>.png` (what was drawn) and `-diff.png` (red
 * where it differs) in `--out` (default: the system's temp folder, `stage-backends/`). The exit code
 * is 1 on any miss.
 *
 *   npm run stage:backends                            (from apps/web; needs the browsers Playwright has)
 *   npm run stage:backends -- --only card,effects     some fixtures
 *   npm run stage:backends -- --targets chromium-webgl2
 *   npm run stage:backends -- --demo out.png          and a side by side of three of them
 *
 * Build the wasm first if the engine changed (`packages/stage/build-web.sh`): this draws with the
 * committed `pkg/` and `pkg-gl/`, which is what the app ships.
 */
import { createServer, type Server } from "node:http";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";
import { chromium, webkit, devices, type Browser, type BrowserContextOptions } from "playwright";

const STAGE = resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/stage");
const GOLDENS = join(STAGE, "crates/gpu/goldens");

/** A channel may be this many levels off… */
const DELTA = 3;
/** …on at most this share of a picture's pixels. */
const SHARE = 0.005;

// ---------------------------------------------------------------------------------------------------
// PNG, enough of it: 8-bit RGBA or RGB, not interlaced.

interface Picture {
	width: number;
	height: number;
	/** RGBA, straight alpha, rows tight. */
	data: Uint8Array;
}

function crc32(bytes: Uint8Array): number {
	let c = ~0;
	for (const b of bytes) {
		c ^= b;
		for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
	}
	return ~c >>> 0;
}

function decodePng(file: Uint8Array): Picture {
	const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
	let at = 8;
	let width = 0;
	let height = 0;
	let channels = 4;
	const idat: Uint8Array[] = [];
	while (at < file.length) {
		const length = view.getUint32(at);
		const type = String.fromCharCode(...file.subarray(at + 4, at + 8));
		const body = file.subarray(at + 8, at + 8 + length);
		if (type === "IHDR") {
			width = view.getUint32(at + 8);
			height = view.getUint32(at + 12);
			const [depth, color, , , interlace] = body.subarray(8, 13);
			if (depth !== 8 || (color !== 6 && color !== 2) || interlace !== 0) throw new Error(`PNG: only 8-bit RGB(A), not interlaced (depth ${depth}, color ${color})`);
			channels = color === 6 ? 4 : 3;
		} else if (type === "IDAT") idat.push(body);
		at += 12 + length;
	}
	const raw = inflateSync(Buffer.concat(idat));
	const stride = width * channels;
	const rows = new Uint8Array(stride * height);
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (stride + 1)];
		const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
		const row = rows.subarray(y * stride, (y + 1) * stride);
		const up = y > 0 ? rows.subarray((y - 1) * stride, y * stride) : new Uint8Array(stride);
		for (let x = 0; x < stride; x++) {
			const a = x >= channels ? row[x - channels] : 0;
			const b = up[x];
			const c = x >= channels ? up[x - channels] : 0;
			let v = src[x];
			if (filter === 1) v += a;
			else if (filter === 2) v += b;
			else if (filter === 3) v += (a + b) >> 1;
			else if (filter === 4) {
				const p = a + b - c;
				const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
				v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
			}
			row[x] = v & 255;
		}
	}
	if (channels === 4) return { width, height, data: rows };
	const data = new Uint8Array(width * height * 4);
	for (let i = 0; i < width * height; i++) data.set([rows[i * 3], rows[i * 3 + 1], rows[i * 3 + 2], 255], i * 4);
	return { width, height, data };
}

function encodePng({ width, height, data }: Picture): Buffer {
	const raw = Buffer.alloc((width * 4 + 1) * height);
	for (let y = 0; y < height; y++) raw.set(data.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
	const chunk = (type: string, body: Uint8Array) => {
		const out = Buffer.alloc(12 + body.length);
		out.writeUInt32BE(body.length, 0);
		out.write(type, 4, "latin1");
		out.set(body, 8);
		out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
		return out;
	};
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header.set([8, 6, 0, 0, 0], 8);
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", new Uint8Array())]);
}

/** A golden as the canvas shows it: premultiplied, as the engine keeps it, laid over white. */
function overWhite({ width, height, data }: Picture): Picture {
	const out = new Uint8Array(data.length);
	for (let i = 0; i < data.length; i += 4) {
		const a = data[i + 3];
		for (let c = 0; c < 3; c++) out[i + c] = Math.round((data[i + c] * a) / 255) + 255 - a;
		out[i + 3] = 255;
	}
	return { width, height, data: out };
}

// ---------------------------------------------------------------------------------------------------
// Comparing.

interface Difference {
	/** Share of pixels with a channel more than `DELTA` off. */
	share: number;
	/** The largest channel difference anywhere. */
	most: number;
	/** Pixels not exactly alike. */
	changed: number;
	same: boolean;
}

function compare(a: Picture, b: Picture): Difference {
	if (a.width !== b.width || a.height !== b.height) return { share: 1, most: 255, changed: a.width * a.height, same: false };
	let far = 0;
	let most = 0;
	let changed = 0;
	for (let i = 0; i < a.data.length; i += 4) {
		const d = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]));
		if (d > 0) changed++;
		if (d > DELTA) far++;
		if (d > most) most = d;
	}
	const share = far / (a.width * a.height);
	return { share, most, changed, same: share <= SHARE };
}

/** Red where `a` is more than `DELTA` off `b`, over `b` in pale grey. */
function diffImage(a: Picture, b: Picture): Picture {
	const out = new Uint8Array(b.data.length);
	for (let i = 0; i < b.data.length; i += 4) {
		const d = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]));
		const grey = 170 + Math.round((b.data[i] + b.data[i + 1] + b.data[i + 2]) / 9);
		out.set(d > DELTA ? [255, 0, 0, 255] : [grey, grey, grey, 255], i);
	}
	return { width: b.width, height: b.height, data: out };
}

/** Every difference from `b`, ×64 in brightness, on black: what the demo's last column shows. */
function amplified(pictures: Picture[], b: Picture): Picture {
	const out = new Uint8Array(b.data.length);
	for (let i = 0; i < b.data.length; i += 4) {
		for (let c = 0; c < 3; c++) out[i + c] = Math.min(255, 64 * Math.max(...pictures.map((p) => Math.abs(p.data[i + c] - b.data[i + c]))));
		out[i + 3] = 255;
	}
	return { width: b.width, height: b.height, data: out };
}

// ---------------------------------------------------------------------------------------------------
// The throwaway server: the page, the two builds, the fonts and the fixture stages.

const TYPES: Record<string, string> = { ".js": "text/javascript", ".wasm": "application/wasm", ".ttf": "font/ttf", ".pen": "application/json", ".html": "text/html" };
const ROOTS: Record<string, string> = { pkg: join(STAGE, "pkg"), "pkg-gl": join(STAGE, "pkg-gl"), fonts: join(STAGE, "fonts"), fixtures: join(STAGE, "crates/gpu/fixtures") };

function serve(): Promise<{ server: Server; url: string }> {
	const server = createServer(async (req, res) => {
		const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
		if (path === "/") {
			res.writeHead(200, { "content-type": "text/html" }).end('<!doctype html><meta charset="utf-8"><body style="margin:0;background:#fff">');
			return;
		}
		const [, root, ...rest] = path.split("/");
		const dir = ROOTS[root];
		const file = dir && resolve(dir, rest.join("/"));
		if (!file || !file.startsWith(dir) || !existsSync(file)) {
			res.writeHead(404).end();
			return;
		}
		res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(await readFile(file));
	});
	return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok({ server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}` })));
}

// ---------------------------------------------------------------------------------------------------
// The browsers.

interface Target {
	slug: string;
	label: string;
	launch: () => Promise<Browser>;
	context: BrowserContextOptions;
	/** Take `navigator.gpu` away, as a browser without WebGPU. */
	noGpu: boolean;
	/** The backend it must open. */
	want: "webgpu" | "webgl2";
}

// WebGPU in headless Chromium only when asked; ANGLE on Metal as Chrome on a Mac has it.
const chromiumArgs = ["--enable-unsafe-webgpu", ...(process.platform === "darwin" ? ["--use-angle=metal"] : ["--enable-unsafe-swiftshader"])];

const TARGETS: Target[] = [
	{ slug: "chromium-webgpu", label: "Chromium · WebGPU", launch: () => chromium.launch({ args: chromiumArgs }), context: { viewport: { width: 1200, height: 900 } }, noGpu: false, want: "webgpu" },
	{ slug: "chromium-webgl2", label: "Chromium · WebGL 2", launch: () => chromium.launch({ args: chromiumArgs }), context: { viewport: { width: 1200, height: 900 } }, noGpu: true, want: "webgl2" },
	{ slug: "webkit-webgl2", label: "WebKit iPhone 15 Pro · WebGL 2", launch: () => webkit.launch(), context: { ...devices["iPhone 15 Pro"] }, noGpu: true, want: "webgl2" },
];

interface Drawn {
	backend: string;
	samples: number;
	maxTexture: number;
	build: string;
	pictures: Record<string, { width: number; height: number; ms: number; data: string } | { error: string }>;
}

/** In the page: load the build this browser would (`backends/detect.ts`: WebGPU only where there is
 * WebGPU), open the engine on a canvas, and draw each fixture onto it, read back at once (in the same
 * task, before the canvas is shown and a WebGL one cleared). */
async function drawAll({ fixtures }: { fixtures: { name: string; stage?: string; width: number; height: number }[] }): Promise<Drawn> {
	const build = "gpu" in navigator ? "/pkg/stage_web.js" : "/pkg-gl/stage_web.js";
	const m = await import(build);
	await m.default();
	const list = JSON.parse(m.Fixtures.list()) as { fonts: [string, string, boolean][] };
	const canvas = document.createElement("canvas");
	canvas.width = canvas.height = 64;
	document.body.append(canvas);
	// Four samples a pixel, as the goldens: a phone short of memory would draw with one.
	const handle = await m.openCanvas(canvas, 64, 64, undefined, false);
	const fx = new m.Fixtures();
	for (const [family, file, fallback] of list.fonts) {
		const res = await fetch(`/fonts/${file}`);
		if (res.ok) fx.addFont(family, new Uint8Array(await res.arrayBuffer()), fallback);
	}
	const out: Drawn = { backend: handle.backend(), samples: handle.samples(), maxTexture: handle.maxTextureSize(), build, pictures: {} };
	const two = document.createElement("canvas");
	const ctx = two.getContext("2d", { willReadFrequently: true })!;
	for (const f of fixtures) {
		try {
			const pen = f.stage ? await (await fetch(`/fixtures/${f.stage}.pen`)).text() : undefined;
			canvas.width = f.width;
			canvas.height = f.height;
			const started = performance.now();
			const [width, height] = fx.show(handle, f.name, pen);
			two.width = width;
			two.height = height;
			ctx.drawImage(canvas, 0, 0);
			const data = ctx.getImageData(0, 0, width, height).data;
			const ms = performance.now() - started;
			let text = "";
			for (let i = 0; i < data.length; i += 0x8000) text += String.fromCharCode(...data.subarray(i, i + 0x8000));
			out.pictures[f.name] = { width, height, ms, data: btoa(text) };
		} catch (e) {
			out.pictures[f.name] = { error: String(e) };
		}
	}
	return out;
}

function noGpu() {
	try {
		delete (Navigator.prototype as { gpu?: unknown }).gpu;
		delete (navigator as { gpu?: unknown }).gpu;
	} catch {
		/* not there to begin with */
	}
}

// ---------------------------------------------------------------------------------------------------

function arg(name: string): string | undefined {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<number> {
	const only = arg("only")?.split(",");
	const targets = TARGETS.filter((t) => !arg("targets") || arg("targets")!.split(",").includes(t.slug));
	const outDir = resolve(arg("out") ?? join(tmpdir(), "stage-backends"));
	const demo = arg("demo");

	// The fixtures are the goldens there are: their names, sizes and pictures.
	const goldens = new Map<string, Picture>();
	for (const file of (await readdir(GOLDENS)).filter((f) => f.endsWith(".png")).sort()) {
		const name = file.slice(0, -4);
		if (only && !only.includes(name)) continue;
		goldens.set(name, overWhite(decodePng(await readFile(join(GOLDENS, file)))));
	}
	const fonts = (await readdir(join(STAGE, "fonts"))).some((f) => f.endsWith(".ttf"));
	const fixtures = [...goldens].filter(([name]) => fonts || name === "shapes" || name === "effects").map(([name, g]) => ({ name, stage: name.startsWith("stage-") ? name.slice(6) : undefined, width: g.width, height: g.height }));
	if (!fonts) console.log("no fonts in packages/stage/fonts: only shapes and effects are drawn");

	const { server, url } = await serve();
	const drawn = new Map<string, Map<string, Picture>>();
	let failed = false;
	const fail = (line: string) => {
		failed = true;
		console.log(`  ✗ ${line}`);
	};
	try {
		for (const target of targets) {
			const browser = await target.launch();
			try {
				const context = await browser.newContext(target.context);
				const page = await context.newPage();
				const errors: string[] = [];
				page.on("pageerror", (e) => errors.push(e.message));
				if (target.noGpu) await page.addInitScript(noGpu);
				await page.goto(url);
				const got = await page.evaluate(drawAll, { fixtures });
				console.log(`${target.label}: ${got.backend}, ${got.samples} samples, textures up to ${got.maxTexture} (${got.build})`);
				if (got.backend !== target.want) fail(`opened ${got.backend}, not ${target.want}`);
				const mine = new Map<string, Picture>();
				drawn.set(target.slug, mine);
				for (const f of fixtures) {
					const p = got.pictures[f.name];
					if (!p || "error" in p) {
						fail(`${f.name}: ${p?.error ?? "not drawn"}`);
						continue;
					}
					const picture = { width: p.width, height: p.height, data: new Uint8Array(Buffer.from(p.data, "base64")) };
					mine.set(f.name, picture);
					const golden = goldens.get(f.name)!;
					const d = compare(picture, golden);
					const line = `${f.name.padEnd(16)} ${p.width}×${p.height}  ${(d.share * 100).toFixed(3).padStart(7)}% over ${DELTA}, at most ${String(d.most).padStart(3)}, ${((d.changed / (p.width * p.height)) * 100).toFixed(2).padStart(6)}% not exact  ${p.ms.toFixed(0)} ms`;
					if (d.same) console.log(`  ✓ ${line}`);
					else {
						fail(line);
						await mkdir(outDir, { recursive: true });
						await writeFile(join(outDir, `${target.slug}-${f.name}.png`), encodePng(picture));
						await writeFile(join(outDir, `${target.slug}-${f.name}-diff.png`), encodePng(diffImage(picture, golden)));
						console.log(`    ${join(outDir, `${target.slug}-${f.name}-diff.png`)}`);
					}
				}
				if (errors.length) fail(`errors on the page: ${errors.join(" | ")}`);
			} finally {
				await browser.close();
			}
		}

		// And against each other: two backends that each pass the golden could still differ by twice the slack.
		const slugs = [...drawn.keys()];
		for (let i = 0; i < slugs.length; i++) {
			for (let j = i + 1; j < slugs.length; j++) {
				const worst = fixtures
					.map((f) => ({ name: f.name, a: drawn.get(slugs[i])!.get(f.name), b: drawn.get(slugs[j])!.get(f.name) }))
					.filter((x) => x.a && x.b)
					.map((x) => ({ name: x.name, d: compare(x.a!, x.b!) }));
				const bad = worst.filter((x) => !x.d.same);
				const most = Math.max(0, ...worst.map((x) => x.d.most));
				const share = Math.max(0, ...worst.map((x) => x.d.share));
				const line = `${slugs[i]} vs ${slugs[j]}: worst ${(share * 100).toFixed(3)}% over ${DELTA}, at most ${most}`;
				if (bad.length) fail(`${line}: ${bad.map((x) => x.name).join(", ")}`);
				else console.log(`✓ ${line}`);
			}
		}

		if (demo) await makeDemo(resolve(demo), drawn, goldens);
	} finally {
		server.close();
	}
	console.log(failed ? "stage-backends: MISMATCH" : `stage-backends: every picture within ${DELTA} levels on ${(100 - SHARE * 100).toFixed(1)}% of its pixels, on ${targets.length} backends`);
	return failed ? 1 : 0;
}

/** Three crops side by side: WebGPU | WebGL 2 Chromium | WebGL 2 WebKit | every difference ×64. */
async function makeDemo(path: string, drawn: Map<string, Map<string, Picture>>, goldens: Map<string, Picture>) {
	const crops = [
		{ name: "effects", x: 0, y: 0, w: 200, h: 200 },
		{ name: "card", x: 0, y: 0, w: 480, h: 300 },
		{ name: "stage-herobrine", x: 60, y: 380, w: 480, h: 300 },
	].filter((c) => goldens.has(c.name) && [...drawn.values()].every((m) => m.has(c.name)));
	const crop = (p: Picture, c: (typeof crops)[0]): Picture => {
		const w = Math.min(c.w, p.width - c.x);
		const h = Math.min(c.h, p.height - c.y);
		const data = new Uint8Array(w * h * 4);
		for (let y = 0; y < h; y++) data.set(p.data.subarray(((c.y + y) * p.width + c.x) * 4, ((c.y + y) * p.width + c.x + w) * 4), y * w * 4);
		return { width: w, height: h, data };
	};
	const src = (p: Picture) => `data:image/png;base64,${encodePng(p).toString("base64")}`;
	const columns = [...drawn.keys()].map((slug) => TARGETS.find((t) => t.slug === slug)!.label);
	const rows = crops.map((c) => {
		const golden = goldens.get(c.name)!;
		const pictures = [...drawn.values()].map((m) => m.get(c.name)!);
		const stats = pictures.map((p) => compare(p, golden));
		const cells = [...pictures.map((p) => crop(p, c)), crop(amplified(pictures, golden), c)];
		const notes = [...stats.map((s) => `${(100 - s.share * 100).toFixed(2)}% within ${DELTA} of the golden · largest difference ${s.most}`), "any backend vs the golden"];
		return `<tr><th>${c.name}</th>${cells.map((p, i) => `<td><img src="${src(p)}" width="${p.width}"><small>${notes[i]}</small></td>`).join("")}</tr>`;
	});
	const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;padding:24px;font:14px/1.35 -apple-system,system-ui,sans-serif;background:#f4f4f2;color:#222}
h1{font-size:20px;margin:0 0 4px}p{margin:0 0 16px;color:#555}
table{border-collapse:separate;border-spacing:10px 8px}th{font-weight:600;text-align:left;vertical-align:top}thead th{font-size:13px}
td small{display:block;color:#666;font-size:11px;margin-top:4px}
td{vertical-align:top;padding:0}img{display:block;image-rendering:pixelated;box-shadow:0 0 0 1px #ccc}
</style><h1>The stage engine, the same pictures on three backends</h1>
<p>Each drawn by the shipped wasm, read back from the engine's canvas, held to the Metal golden. Last column: every difference from the golden, ×64 (black = identical).</p>
<table><thead><tr><th></th>${columns.map((c) => `<th>${c}</th>`).join("")}<th>Differences ×64</th></tr></thead>${rows.join("")}</table>`;
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage({ viewport: { width: 2000, height: 600 }, deviceScaleFactor: 1 });
		await page.setContent(html);
		const box = await page.evaluate(() => ({ w: document.body.scrollWidth, h: document.body.scrollHeight }));
		await page.setViewportSize({ width: box.w, height: box.h });
		await mkdir(dirname(path), { recursive: true });
		await page.screenshot({ path, fullPage: true });
		console.log(`demo: ${path}`);
	} finally {
		await browser.close();
	}
}

process.exitCode = await main();
