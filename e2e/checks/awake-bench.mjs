/**
 * What a pan and a zoom cost on a canvas heavy with cards, apps and documents: the bench for the one
 * surface lifecycle (`items/awake.ts`). Measures, not a check. One canvas, two scenarios, three runs each,
 * under a minute: run it before a change and after, and keep the change if its numbers hold.
 *
 * The canvas is `e2e/awake-canvas.mjs` (100 cards, 8 animating apps, 4 documents), written into this
 * check's deck. The camera rests at 50% on the busiest spot; then, with real wheel input at 120 Hz:
 *
 * - `pan`: `SECONDS` there and back at 50%;
 * - `zoom`: a pinch from 25% to 100% and back, at the same spot.
 *
 * Per scenario, the median over `RUNS` runs after one warm-up:
 *
 * - gapP50 / gapP95 / gapMax, and `missed`, the share of frame gaps over 12 ms;
 * - mainMs / scriptMs / layoutMs / styleMs: main-thread time per frame (CDP `Performance`);
 * - nodes: placed-item nodes in the world at rest before the run; nodesMid: nodes added during it (should be 0);
 * - statusReqs: app status requests the frame made during the run; engineCalls / engineKB: `setCards` calls and bytes;
 * - picturesFetched: picture requests during the run; live: awake items of each kind at rest, as the stage says.
 *
 * `AWAKE_BENCH_ONLY=pan` or `zoom`; `AWAKE_BENCH_RUNS`, `AWAKE_BENCH_SECONDS`; `AWAKE_BENCH_OUT=<file>` writes the JSON.
 * `AWAKE_BENCH_PROFILE=<file>` writes a CPU profile of the canvas frame's main thread over the measured runs
 * (a `.cpuprofile`, 100 µs samples), summed by `scripts/profile-shares.mjs`. `AWAKE_BENCH_TRACE=<file>` writes a
 * Chrome trace of the same runs instead (the renderer's timeline events: input, script, style, paint, commit),
 * summed by `scripts/trace-shares.mjs`; one or the other, not both.
 * - cardLists: how often the stage rebuilt the list of cards it hands the engine during the run (`items-layer.tsx`; should be about 0).
 */
import { writeFileSync } from "node:fs";
import { API, asPerson, canvasFrame, deckState, open, say, socket } from "../harness.mjs";
import { AWAKE_CANVAS, writeAwakeCanvas } from "../awake-canvas.mjs";

const RUNS = Math.max(1, Number(process.env.AWAKE_BENCH_RUNS ?? 3));
const SECONDS = Number(process.env.AWAKE_BENCH_SECONDS ?? 1.2);
const OUT = process.env.AWAKE_BENCH_OUT;
const ONLY = (process.env.AWAKE_BENCH_ONLY ?? "pan,zoom").split(",");
const PROFILE = process.env.AWAKE_BENCH_PROFILE;
const TRACE = process.env.AWAKE_BENCH_TRACE;
/** `AWAKE_BENCH_LAYERS=<file>`: the compositor's layers mid-zoom, with why each is one, written there. */
const LAYERS = process.env.AWAKE_BENCH_LAYERS;
/**
 * `AWAKE_BENCH_PICTURES=1`: every card has its picture before anything is measured. The canvas is written
 * into a fresh deck, so its cards have none, and the engine paints 100 placeholders instead of pictures,
 * which is the uncommon case: a real canvas has placeholders only for new cards. The bench asks the server
 * for each card's whole picture (two at a time, as the server takes them) and waits until the frame holds one
 * for every card near the window; the rungs the frame then wants are cut from the whole ones.
 */
const PICTURES = process.env.AWAKE_BENCH_PICTURES === "1";
/** `AWAKE_BENCH_PANEL=closed`: the side panel shut, to measure what its layers cost the compositor. */
const PANEL = process.env.AWAKE_BENCH_PANEL;
const W = 1500;
const H = 950;
const DPR = 2;
const ZOOM = 0.5;
/** CPU slowdown (CDP `setCPUThrottlingRate`): this M4 pans anything at 120 Hz; a 4× slower one is where the costs show. */
const THROTTLE = Number(process.env.AWAKE_BENCH_THROTTLE ?? 4);

const until = async (test, ms = 20000) => {
	const t0 = Date.now();
	for (;;) {
		const v = await test();
		if (v) return v;
		if (Date.now() - t0 > ms) return undefined;
		await new Promise((r) => setTimeout(r, 100));
	}
};
const quantile = (values, q) => {
	if (!values.length) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};
const r1 = (n) => Math.round(n * 10) / 10;
/** Where the bench is, for the watchdog: a bench that hangs says which phase it hung in. */
let phase = "start";
const at = (name) => {
	phase = name;
	console.error(`[awake-bench] ${new Date().toISOString().slice(11, 19)} ${name}`);
};
setTimeout(() => {
	say(`the bench finished within four minutes (hung in: ${phase})`, false);
	process.exit(1);
}, PICTURES ? 600_000 : 240_000).unref();
const median = (rows, key) => quantile(rows.map((r) => r[key]).filter((v) => typeof v === "number"), 0.5);

// --- the canvas ---------------------------------------------------------------------------------------
at("writing the canvas");
const deck = await deckState();
const written = writeAwakeCanvas(deck.path);
say("the awake canvas is written into the deck", written.cards === 100 && written.apps === 8 && written.documents === 4, JSON.stringify(written));

/** The world point where a window at `zoom` sees the most placed items, apps and documents counting for four each, so the spot has every kind in view. */
const busiest = (pen, zoom) => {
	const items = pen.children.filter((n) => n.type === "browser").map((n) => ({ x: n.x ?? 0, y: n.y ?? 0, w: n.width ?? 1000, h: n.height ?? 700, weight: n.metadata?.type === "decks.card" ? 1 : 4 }));
	const vw = W / zoom;
	const vh = H / zoom;
	let best = { n: -1, score: -1, x: 0, y: 0 };
	for (const b of items) {
		const cx = b.x + b.w / 2;
		const cy = b.y + b.h / 2;
		const seen = items.filter((o) => o.x < cx + vw / 2 && o.x + o.w > cx - vw / 2 && o.y < cy + vh / 2 && o.y + o.h > cy - vh / 2);
		const score = seen.reduce((sum, o) => sum + o.weight, 0);
		if (score > best.score) best = { n: seen.length, score, x: cx, y: cy };
	}
	return best;
};
const { readFileSync } = await import("node:fs");
const { join } = await import("node:path");
const pen = JSON.parse(readFileSync(join(written.folder, "canvas.pen"), "utf8"));
const spot = busiest(pen, ZOOM);

// --- the page -----------------------------------------------------------------------------------------
at("opening the page");
const link = await socket();
const agentId = await until(() => link.last("agents")?.focused);
say("the server says which agent is focused", !!agentId);
const { page, context, errors } = await open({ width: W, height: H, dpr: DPR, cards: false });
const cdp = await context.newCDPSession(page);
await cdp.send("Performance.enable", { timeDomain: "threadTicks" });
if (THROTTLE > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
/** Requests the page makes while a run records: app status asks, and pictures. */
let counting = false;
const counts = { status: 0, pictures: 0 };
page.on("request", (request) => {
	if (!counting) return;
	const url = request.url();
	if (request.method() === "GET" && /\/apps\/[^/?]+$/.test(url)) counts.status++;
	if (/\/pictures?\/|\/api\/picture|[?&]w=\d+/.test(url)) counts.pictures++;
});

at("switching to the awake canvas");
link.send({ type: "agent.stage", id: agentId, stage: AWAKE_CANVAS });
setTimeout(() => link.send({ type: "stage.pen.get", agentId }), 1200);
await until(() => link.received.some((m) => m.type === "stage.pen" && m.stage === AWAKE_CANVAS), 20000);
at("reloading onto it");
await page.reload({ waitUntil: "domcontentloaded" });
let canvas = await canvasFrame(page, { timeout: 90000 }).catch((error) => {
	say("the canvas frame shows its stage", false, `${error.message}; page errors: ${errors.join(" | ")}; frames: ${page.frames().map((f) => f.url().slice(0, 60)).join(", ")}`);
	process.exit(1);
});
at("waiting for 112 items");
const shown = await canvas
	.waitForFunction(() => (globalThis.__decksCards?.().length ?? 0) >= 112, undefined, { timeout: 30000 })
	.then(() => true)
	.catch(() => false);
say("the stage shows the awake canvas", shown, String(await canvas.evaluate(() => globalThis.__decksCards?.().length)));

if (PICTURES) {
	at("taking every card's picture");
	// A card's path in the canvas file is from the canvas's own folder; the server's is from the deck.
	const paths = pen.children.filter((n) => n.type === "browser" && n.metadata?.type === "decks.card").map((n) => (n.metadata.path.startsWith("canvases/") ? n.metadata.path : `canvases/${AWAKE_CANVAS}/${n.metadata.path}`));
	const headers = await asPerson(API);
	let done = 0;
	let failed = 0;
	const t0 = Date.now();
	let why = "";
	/** True once the card's own whole picture came: a stand-in (another size, sent while the real one is taken) means ask again. */
	const take = async (path) => {
		const url = `${API}/api/thumb/${path.split("/").map(encodeURIComponent).join("/")}?whole=1&scheme=dark`;
		const response = await fetch(url, { headers }).catch((error) => (why ||= `${url}: ${error.message}`, undefined));
		await response?.arrayBuffer().catch(() => {});
		if (response?.ok && !response.headers.get("x-decks-stand-in")) return true;
		if (response && !response.ok && !why) why = `${url}: ${response.status}`;
		return false;
	};
	let queue = [...paths];
	for (let round = 0; round < 4 && queue.length; round++) {
		const again = [];
		await Promise.all(Array.from({ length: 2 }, async () => {
			for (let path = queue.shift(); path; path = queue.shift()) if (await take(path)) done++; else again.push(path);
		}));
		queue = again;
		if (queue.length) await new Promise((r) => setTimeout(r, 2000));
	}
	failed = queue.length;
	say(`every card has its picture (${done} of ${paths.length} taken in ${Math.round((Date.now() - t0) / 1000)} s)`, failed === 0, failed ? `${failed} still without; first: ${why}` : "");
	// The frame hears of each picture as it is made (the sheet asks again); a reload is the sure way to a clean start with them.
	await page.reload({ waitUntil: "domcontentloaded" });
	canvas = await canvasFrame(page, { timeout: 90000 });
	await canvas.waitForFunction(() => (globalThis.__decksCards?.().length ?? 0) >= 112, undefined, { timeout: 30000 }).catch(() => {});
}

if (PANEL === "closed") {
	await page.locator('button[aria-label="Hide the side panel"]').first().click({ timeout: 10000 });
	await page.waitForTimeout(500);
}

await canvas.evaluate(() => {
	const stage = () => document.querySelector(".stage");
	const raf = () => new Promise((done) => requestAnimationFrame(() => done()));
	const wheel = (deltaX, deltaY, ctrlKey) => {
		const r = stage().getBoundingClientRect();
		stage().dispatchEvent(new WheelEvent("wheel", { deltaX, deltaY, ctrlKey, deltaMode: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }));
	};
	const nodes = () => document.querySelectorAll(".world .card-node").length;
	globalThis.__bench = {
		async zoomTo(zoom) {
			for (let i = 0; i < 200; i++) {
				const now = globalThis.__decksRust.camera.zoom;
				const ln = Math.log(zoom / now);
				if (Math.abs(ln) < 1e-6) return;
				wheel(0, -64 * Math.max(-Math.log(1.29), Math.min(Math.log(1.29), ln)), true);
				await raf();
			}
		},
		async panTo(x, y) {
			for (let i = 0; i < 30; i++) {
				const c = globalThis.__decksRust.camera;
				const dx = (x - c.x) * c.zoom;
				const dy = (y - c.y) * c.zoom;
				if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
				wheel(Math.max(-3000, Math.min(3000, dx)), Math.max(-3000, Math.min(3000, dy)), false);
				await raf();
				await raf();
			}
		},
		nodes,
		/** Items of each kind with a surface on the page: a card's shadow host, an app's window (and how many show the app), a document's editor. */
		live() {
			return {
				cards: document.querySelectorAll(".world .card-host").length,
				apps: document.querySelectorAll(".world .app-surface").length,
				appsShowing: document.querySelectorAll(".world .app-surface[data-live]").length,
				documents: document.querySelectorAll(".world .document-surface").length,
			};
		},
		engine() {
			const s = globalThis.__decksEngine?.stats?.() ?? {};
			return s.cardsSent ?? { calls: 0, bytes: 0 };
		},
		record() {
			this.frames = [];
			this.moving = 0;
			this.added = 0;
			this.recording = true;
			this.observer?.disconnect();
			this.observer = new MutationObserver((list) => {
				for (const m of list) for (const n of m.addedNodes) if (n instanceof Element && (n.matches(".card-node") || n.querySelector?.(".card-node"))) this.added++;
			});
			this.observer.observe(document.querySelector(".world"), { childList: true, subtree: true });
			const tick = (t) => {
				if (!this.recording) return;
				this.frames.push(t);
				if (stage()?.dataset.moving === "true") this.moving++;
				requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		},
		stop() {
			this.recording = false;
			this.observer?.disconnect();
			return { frames: this.frames, moving: this.moving, added: this.added };
		},
	};
});

/** Until the camera is still and nothing has changed for `ms`. */
const quiet = (ms = 1200, cap = 15000) =>
	canvas.evaluate(
		async ({ ms, cap }) => {
			const t0 = performance.now();
			const pictures = () => globalThis.__decksEngine?.stats?.().pictures ?? 0;
			let last = JSON.stringify([globalThis.__decksSheet?.tiles ?? 0, document.querySelectorAll(".world .card-node").length, document.querySelectorAll("iframe").length, pictures()]);
			let at = performance.now();
			while (performance.now() - t0 < cap) {
				await new Promise((done) => setTimeout(done, 100));
				const now = JSON.stringify([globalThis.__decksSheet?.tiles ?? 0, document.querySelectorAll(".world .card-node").length, document.querySelectorAll("iframe").length, pictures()]);
				const d = document.querySelector(".stage")?.dataset;
				if (now !== last || d?.moving === "true" || d?.gliding === "true") {
					last = now;
					at = performance.now();
				} else if (performance.now() - at >= ms) return true;
			}
			return false;
		},
		{ ms, cap },
	);

/** The page's session profiles the canvas frame too: in headless Chromium the sandboxed frame shares the page's process and main thread. */
const frameCdp = PROFILE ? cdp : undefined;
if (frameCdp) {
	await frameCdp.send("Profiler.enable");
	await frameCdp.send("Profiler.setSamplingInterval", { interval: 100 });
}
let profiling = false;
/** The trace's events, gathered as they stream. */
const traced = [];
if (TRACE) cdp.on("Tracing.dataCollected", (event) => traced.push(...event.value));
const frameBox = await page.locator("iframe.canvas-frame").boundingBox();
const point = { x: frameBox.x + frameBox.width / 2, y: frameBox.y + frameBox.height / 2 };

/** The compositor's layers as they are now, each with its element and the reasons it is a layer (CDP `LayerTree`). */
const describeLayers = async () => {
	let layers = [];
	const heard = new Promise((done) => cdp.once("LayerTree.layerTreeDidChange", (e) => done(e.layers ?? [])));
	await cdp.send("LayerTree.enable");
	layers = await Promise.race([heard, new Promise((r) => setTimeout(() => r([]), 1500))]);
	await cdp.send("DOM.enable").catch(() => {});
	const lines = [];
	for (const layer of layers) {
		const reasons = await cdp.send("LayerTree.compositingReasons", { layerId: layer.layerId }).then((r) => r.compositingReasonIds ?? r.compositingReasons ?? []).catch(() => []);
		let node = "";
		if (layer.backendNodeId) node = await cdp.send("DOM.describeNode", { backendNodeId: layer.backendNodeId }).then((r) => `${r.node.localName}${r.node.attributes ? "." + (r.node.attributes[r.node.attributes.indexOf("class") + 1] ?? "") : ""}`).catch(() => "?");
		lines.push(`${String(layer.width).padStart(6)}×${String(layer.height).padEnd(6)} ${node.padEnd(28)} ${reasons.join(",")}${layer.drawsContent ? "" : " (draws nothing)"}`);
	}
	writeFileSync(LAYERS, `${layers.length} compositor layers mid-zoom:\n  ${lines.join("\n  ")}\n`);
	await cdp.send("LayerTree.disable").catch(() => {});
};

/** One run: wheel input at 120 Hz for SECONDS, there and back; a pan or a pinch. */
const run = async (kind) => {
	const before = await metrics();
	const engineBefore = await canvas.evaluate(() => globalThis.__bench.engine());
	const listsBefore = await canvas.evaluate(() => globalThis.__decksCardLists ?? 0);
	const nodes = await canvas.evaluate(() => globalThis.__bench.nodes());
	counts.status = 0;
	counts.pictures = 0;
	counting = true;
	await canvas.evaluate(() => globalThis.__bench.record());
	const n = Math.round(SECONDS * 120);
	const t0 = Date.now();
	const sent = [];
	// A pinch from 25% to 100% is a factor of 4 over n/2 steps: each step ctrl-wheel of ln(4)/(n/2) in the zoom's units (64 per e-fold, as the stage reads it).
	const pinchStep = (64 * Math.log(4)) / (n / 2);
	for (let i = 0; i < n; i++) {
		const back = i >= n / 2 ? -1 : 1;
		const event = kind === "pan" ? { type: "mouseWheel", x: point.x, y: point.y, deltaX: 12 * back, deltaY: 4 * back } : { type: "mouseWheel", x: point.x, y: point.y, deltaX: 0, deltaY: pinchStep * back, modifiers: 2 };
		sent.push(cdp.send("Input.dispatchMouseEvent", event));
		const wait = t0 + ((i + 1) * 1000) / 120 - Date.now();
		if (wait > 0) await new Promise((r) => setTimeout(r, wait));
	}
	await Promise.all(sent);
	if (LAYERS && kind === "zoom" && !run.layersShown) {
		run.layersShown = true;
		await describeLayers();
	}
	await canvas.evaluate(() => new Promise((r) => setTimeout(r, 50)));
	const got = await canvas.evaluate(() => globalThis.__bench.stop());
	counting = false;
	const after = await metrics();
	const engineAfter = await canvas.evaluate(() => globalThis.__bench.engine());
	const listsAfter = await canvas.evaluate(() => globalThis.__decksCardLists ?? 0);
	const gaps = got.frames.slice(1).map((t, i) => t - got.frames[i]);
	const per = (k) => ((after[k] - before[k]) * 1000) / Math.max(1, gaps.length);
	return {
		frames: gaps.length,
		gapP50: r1(quantile(gaps, 0.5)),
		gapP95: r1(quantile(gaps, 0.95)),
		gapMax: r1(Math.max(...gaps)),
		missed: Math.round((gaps.filter((g) => g > 12).length / Math.max(1, gaps.length)) * 100) / 100,
		mainMs: r1(per("TaskDuration")),
		scriptMs: r1(per("ScriptDuration")),
		layoutMs: r1(per("LayoutDuration")),
		styleMs: r1(per("RecalcStyleDuration")),
		nodes,
		nodesMid: got.added,
		movingFrames: Math.round((got.moving / Math.max(1, gaps.length)) * 100) / 100,
		statusReqs: counts.status,
		picturesFetched: counts.pictures,
		engineCalls: engineAfter.calls - engineBefore.calls,
		engineKB: Math.round((engineAfter.bytes - engineBefore.bytes) / 1024),
		cardLists: listsAfter - listsBefore,
	};
};

const result = { setup: { runs: RUNS, seconds: SECONDS, width: W, height: H, dpr: DPR, zoom: ZOOM, throttle: THROTTLE, spot }, scenarios: {} };
for (const kind of ONLY) {
	at(`${kind}: zooming`);
	await canvas.evaluate((z) => globalThis.__bench.zoomTo(z), kind === "pan" ? ZOOM : 0.25);
	await canvas.evaluate(({ x, y }) => globalThis.__bench.panTo(x, y), { x: spot.x - W / 2 / (kind === "pan" ? ZOOM : 0.25), y: spot.y - H / 2 / (kind === "pan" ? ZOOM : 0.25) });
	at(`${kind}: resting`);
	await quiet();
	const live = await canvas.evaluate(() => globalThis.__bench.live());
	const rows = [];
	for (let i = -1; i < RUNS; i++) {
		at(`${kind}: run ${i}`);
		// The profile covers the measured runs alone, every scenario in one: started after the warm-up, stopped at the end.
		if (frameCdp && i === 0 && !profiling) {
			profiling = true;
			await frameCdp.send("Profiler.start");
		}
		if (TRACE && i === 0 && !profiling) {
			profiling = true;
			await cdp.send("Tracing.start", { traceConfig: { includedCategories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "blink.user_timing", "v8.execute", "disabled-by-default-v8.gc"], recordMode: "recordContinuously" }, transferMode: "ReportEvents" });
		}
		const row = await run(kind);
		await quiet();
		if (i >= 0) rows.push(row);
	}
	const keys = Object.keys(rows[0]);
	const sum = Object.fromEntries(keys.map((k) => [k, median(rows, k)]));
	result.scenarios[kind] = { itemsInView: spot.n, live, ...sum };
	say(`${kind} measured over ${RUNS} runs`, rows.length === RUNS, JSON.stringify(result.scenarios[kind]));
}
at("done");
if (TRACE && profiling) {
	const ended = new Promise((done) => cdp.once("Tracing.tracingComplete", done));
	await cdp.send("Tracing.end");
	await ended;
	writeFileSync(TRACE, JSON.stringify({ traceEvents: traced }));
	console.error(`[awake-bench] trace written to ${TRACE}, ${traced.length} events`);
}
if (frameCdp && profiling) {
	const { profile } = await frameCdp.send("Profiler.stop");
	writeFileSync(PROFILE, JSON.stringify(profile));
	console.error(`[awake-bench] profile written to ${PROFILE}`);
}
if (OUT) writeFileSync(OUT, JSON.stringify(result, null, "\t"));
await page.close().catch(() => {});
// The harness's socket would keep the process alive.
process.exit(0);
