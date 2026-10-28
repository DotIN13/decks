/**
 * What a pan costs on canvases heavy with boards and drawing.
 *
 * Not a pass/fail check: it measures. Two canvases are written into the check's deck:
 *
 * - `real`: a copy of a real canvas (`PAN_HEAVY_SOURCE`, the Decks Studio canvas of this machine's
 *   deck by default): 26 boards and about a thousand drawn items, designs and notes.
 * - `perf`: the 10 × 10 render-perf grid (`e2e/perf-canvas.mjs`), 2,000 drawn items, with every one
 *   of its 100 boards a real board's page instead of the generated one.
 *
 * For each canvas and zoom, the camera rests on the busiest place, then real wheel input (CDP
 * `mouseWheel`, at 120 Hz from a timer, not paced by frames) pans for `SECONDS` there and back. The
 * page records every animation frame. Reported per scenario, as the median over `RUNS` runs:
 *
 * - gapP50 / gapP95 / gapMax: ms between frames (8.3 ms is every frame at 120 Hz);
 * - missed: the share of frame gaps over 12 ms;
 * - mainMs: main-thread time per frame (`TaskDuration`), and its script, style and layout parts;
 * - pictured / pagesShown: the share of frames drawn with boards as pictures, and the pages showing a frame;
 * - movingFrames / travelPx: the share of frames the stage called moving, and how far the camera went.
 *
 * `PAN_HEAVY_ONLY=real@0.25,perf@0.5` picks scenarios; `PAN_HEAVY_AB=<localStorage key>` runs each
 * scenario with the key unset and set to "1", alternating, the camera at rest between (`decks.noPictures`
 * compares pictures while moving with live pages); `PAN_HEAVY_TRACE=<file prefix>` writes a
 * Chrome trace of the first measured run of each scenario.
 */
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { deckState, open, say, socket } from "../harness.mjs";
import { CELL, GRID, writePerfCanvas } from "../perf-canvas.mjs";

const RUNS = Math.max(1, Number(process.env.PAN_HEAVY_RUNS ?? 5));
const SECONDS = Number(process.env.PAN_HEAVY_SECONDS ?? 1.6);
const STEP = Number(process.env.PAN_HEAVY_STEP ?? 12);
const AB = process.env.PAN_HEAVY_AB;
const TRACE = process.env.PAN_HEAVY_TRACE;
const PROFILE = process.env.PAN_HEAVY_PROFILE;
const OUT = process.env.PAN_HEAVY_OUT;
const SOURCE = process.env.PAN_HEAVY_SOURCE ?? join(homedir(), "Documents/DotGit/dotty-programs/decks/data/decks/canvases/decks-studio");
const W = Number(process.env.PAN_HEAVY_W ?? 1500);
const H = Number(process.env.PAN_HEAVY_H ?? 950);
const DPR = Number(process.env.PAN_HEAVY_DPR ?? 2);
/** CPU slowdown (CDP `setCPUThrottlingRate`), to stand in for a slower machine than this M4. */
const THROTTLE = Number(process.env.PAN_HEAVY_THROTTLE ?? 1);
const SCENARIOS = (process.env.PAN_HEAVY_ONLY ?? "real@0.12,real@0.25,real@0.5,perf@0.15,perf@0.25,perf@0.5").split(",").map((s) => {
	const [canvas, zoom] = s.split("@");
	return { canvas, zoom: Number(zoom) };
});

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
	const s = [...values].sort((a, b) => a - b);
	return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN;
};
const median = (values) => quantile(values, 0.5);
const r1 = (v) => Math.round(v * 10) / 10;

// --- the canvases -------------------------------------------------------------------------------------
const deck = await deckState();
const real = join(deck.path, "canvases", "real");
say("the real canvas to copy exists", existsSync(join(SOURCE, "canvas.pen")), SOURCE);
cpSync(SOURCE, real, { recursive: true });
writeFileSync(join(real, "canvas.json"), JSON.stringify({ title: "Real heavy", boards: [] }, null, "\t"));
const realBoards = readdirSync(join(real, "boards")).filter((f) => f.endsWith(".html"));

writePerfCanvas(deck.path, { items: 2000, boards: 100 });
const perfBoards = readdirSync(join(deck.path, "canvases", "perf", "boards")).filter((f) => f.endsWith(".html"));
perfBoards.forEach((name, i) => {
	const html = readFileSync(join(real, "boards", realBoards[i % realBoards.length]), "utf8");
	writeFileSync(join(deck.path, "canvases", "perf", "boards", name), html);
});

/** The world point where a window at `zoom` sees the most boards, from the canvas file. */
const busiest = (canvas, zoom) => {
	const pen = JSON.parse(readFileSync(join(deck.path, "canvases", canvas, "canvas.pen"), "utf8"));
	const boards = pen.children.filter((n) => n.type === "browser").map((n) => ({ x: n.x ?? 0, y: n.y ?? 0, w: n.width ?? 1000, h: n.height ?? 700 }));
	const vw = W / zoom;
	const vh = H / zoom;
	let best = { n: -1, x: 0, y: 0 };
	for (const b of boards) {
		const cx = b.x + b.w / 2;
		const cy = b.y + b.h / 2;
		const n = boards.filter((o) => o.x < cx + vw / 2 && o.x + o.w > cx - vw / 2 && o.y < cy + vh / 2 && o.y + o.h > cy - vh / 2).length;
		if (n > best.n) best = { n, x: cx, y: cy };
	}
	return best;
};

// --- the page -----------------------------------------------------------------------------------------
const link = await socket();
const agentId = await until(() => link.last("agents")?.focused);
say("the server says which agent is focused", !!agentId);
const { page, context, errors } = await open({ width: W, height: H, dpr: DPR, boards: false });
const cdp = await context.newCDPSession(page);
await cdp.send("Performance.enable", { timeDomain: "threadTicks" });
if (THROTTLE > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));

const goCanvas = async (canvas) => {
	link.send({ type: "agent.stage", id: agentId, stage: canvas });
	setTimeout(() => link.send({ type: "stage.pen.get", agentId }), 1200);
	await until(() => link.received.some((m) => m.type === "stage.pen" && m.stage === canvas), 20000);
	// The page opens on the agent's canvas; a page already open is reloaded onto it.
	await page.reload({ waitUntil: "domcontentloaded" });
	await page.evaluate(helpers);
	const ok = await page
		.waitForFunction((n) => (globalThis.__decksBoards?.().length ?? 0) >= n, canvas === "perf" ? 90 : Math.min(20, realBoards.length), { timeout: 30000 })
		.then(() => true)
		.catch(() => false);
	if (!ok && process.env.PAN_HEAVY_DEBUG) say("DEBUG", false, JSON.stringify([...new Set(link.received.map((m) => m.type))]), JSON.stringify(link.received.filter((m) => /board|stage$/.test(m.type)).slice(-3)).slice(0, 3000));
	say(`the stage shows the ${canvas} canvas`, ok, String(await page.evaluate(() => globalThis.__decksBoards?.().length)));
};

const helpers = () => {
	const stage = () => document.querySelector(".stage");
	const raf = () => new Promise((done) => requestAnimationFrame(() => done()));
	const wheel = (deltaX, deltaY, ctrlKey) => {
		const r = stage().getBoundingClientRect();
		stage().dispatchEvent(new WheelEvent("wheel", { deltaX, deltaY, ctrlKey, deltaMode: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }));
	};
	globalThis.__pan = {
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
		frames: [],
		recording: false,
		record() {
			this.frames = [];
			this.pictured = 0;
			this.shown = 0;
			this.movingFrames = 0;
			this.travel = 0;
			this.last = undefined;
			this.recording = true;
			const tick = (t) => {
				if (!this.recording) return;
				this.frames.push(t);
				// Frames drawn with the boards as pictures, and the pages showing then, to say which way a pan ran.
				if (stage()?.dataset.pictures === "true") this.pictured++;
				if (stage()?.dataset.moving === "true") this.movingFrames = (this.movingFrames ?? 0) + 1;
				const c = globalThis.__decksRust?.camera;
				if (c) {
					if (this.last) this.travel = (this.travel ?? 0) + Math.hypot(c.x - this.last.x, c.y - this.last.y) * c.zoom;
					this.last = { x: c.x, y: c.y };
				}
				this.shown += [...document.querySelectorAll("iframe")].filter((f) => getComputedStyle(f).visibility !== "hidden").length;
				requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		},
		stop() {
			this.recording = false;
			return this.frames;
		},
		seen() {
			return { pictured: this.pictured / Math.max(1, this.frames.length), pagesShown: this.shown / Math.max(1, this.frames.length), moving: this.movingFrames / Math.max(1, this.frames.length), travel: this.travel };
		},
		state() {
			const s = stage();
			return { live: s?.dataset.live === "true", moving: s?.dataset.moving === "true", pages: document.querySelectorAll("iframe").length, shown: [...document.querySelectorAll("iframe")].filter((f) => getComputedStyle(f).visibility !== "hidden").length };
		},
	};
};

/** Until the camera is still, no tile has come for `ms`, and live boards have their pages. */
const quiet = (ms = 1500, cap = 20000) =>
	page.evaluate(
		async ({ ms, cap }) => {
			const t0 = performance.now();
			let last = globalThis.__decksSheet?.tiles ?? 0;
			let frames = document.querySelectorAll("iframe").length;
			let at = performance.now();
			while (performance.now() - t0 < cap) {
				await new Promise((done) => setTimeout(done, 100));
				const n = globalThis.__decksSheet?.tiles ?? 0;
				const f = document.querySelectorAll("iframe").length;
				const d = document.querySelector(".stage")?.dataset;
				if (n !== last || f !== frames || d?.moving === "true" || d?.gliding === "true") {
					last = n;
					frames = f;
					at = performance.now();
				} else if (performance.now() - at >= ms) return true;
			}
			return false;
		},
		{ ms, cap },
	);

/** One pan there and back with real wheel input at 120 Hz, the pointer at `point`. */
const pan = async (point) => {
	const before = await metrics();
	await page.evaluate(() => globalThis.__pan.record());
	const n = Math.round(SECONDS * 120);
	const t0 = Date.now();
	const sent = [];
	for (let i = 0; i < n; i++) {
		const back = i >= n / 2 ? -1 : 1;
		// Not awaited: input arrives on its own clock, as a trackpad's does, whatever the page is doing.
		sent.push(cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: point.x, y: point.y, deltaX: STEP * back, deltaY: (STEP / 3) * back }));
		const wait = t0 + ((i + 1) * 1000) / 120 - Date.now();
		if (wait > 0) await new Promise((r) => setTimeout(r, wait));
	}
	await Promise.all(sent);
	const ms = Date.now() - t0;
	await page.evaluate(() => new Promise((r) => setTimeout(r, 50)));
	const frames = await page.evaluate(() => globalThis.__pan.stop());
	const seen = await page.evaluate(() => globalThis.__pan.seen());
	const after = await metrics();
	const gaps = frames.slice(1).map((t, i) => t - frames[i]);
	const per = (k) => ((after[k] - before[k]) * 1000) / Math.max(1, gaps.length);
	return {
		inputMs: ms,
		frames: gaps.length,
		gapP50: quantile(gaps, 0.5),
		gapP95: quantile(gaps, 0.95),
		gapMax: Math.max(...gaps),
		missed: gaps.filter((g) => g > 12).length / Math.max(1, gaps.length),
		mainMs: per("TaskDuration"),
		scriptMs: per("ScriptDuration"),
		styleMs: per("RecalcStyleDuration"),
		layoutMs: per("LayoutDuration"),
		pictured: Math.round(seen.pictured * 100) / 100,
		pagesShown: Math.round(seen.pagesShown * 10) / 10,
		movingFrames: Math.round(seen.moving * 100) / 100,
		travelPx: Math.round(seen.travel),
	};
};

/**
 * Busy time per frame on each thread that draws, from a Chrome trace of one pan: the GPU process's main
 * thread, the display compositor, the page's main thread and compositor, and every other renderer's
 * (board pages in their own processes) together. Top-level tasks only, so nothing is counted twice.
 */
const threadTimes = (events, frames) => {
	const names = new Map();
	const procs = new Map();
	for (const e of events) {
		if (e.ph !== "M") continue;
		if (e.name === "thread_name") names.set(`${e.pid}:${e.tid}`, e.args.name);
		if (e.name === "process_name") procs.set(e.pid, e.args.name);
	}
	const busy = new Map();
	for (const e of events) {
		if (e.ph !== "X" || !e.dur) continue;
		if (!/^(ThreadControllerImpl::RunTask|ThreadPool_RunTask|RunTask)$/.test(e.name)) continue;
		const k = `${e.pid}:${e.tid}`;
		busy.set(k, (busy.get(k) ?? 0) + e.dur / 1000);
	}
	const renderers = [...procs].filter(([, n]) => n === "Renderer").map(([pid]) => pid);
	const mainOf = (pid) => [...busy].filter(([k]) => k.startsWith(`${pid}:`) && names.get(k) === "CrRendererMain").reduce((a, [, v]) => a + v, 0);
	const page = renderers.sort((a, b) => mainOf(b) - mainOf(a))[0];
	const sum = (test) => [...busy].filter(([k]) => test(Number(k.split(":")[0]), names.get(k) ?? "")).reduce((a, [, v]) => a + v, 0) / Math.max(1, frames);
	const gpuPid = [...procs].find(([, n]) => n === "GPU Process")?.[0];
	return {
		gpuMain: r1(sum((pid, n) => pid === gpuPid && n === "CrGpuMain")),
		viz: r1(sum((pid, n) => pid === gpuPid && n === "VizCompositorThread")),
		pageMain: r1(sum((pid, n) => pid === page && n === "CrRendererMain")),
		pageCompositor: r1(sum((pid, n) => pid === page && n === "Compositor")),
		raster: r1(sum((pid, n) => pid === page && /CompositorTileWorker/.test(n))),
		otherRenderers: r1(sum((pid) => renderers.includes(pid) && pid !== page)),
		renderers: renderers.length,
	};
};

const result = { scenarios: {} };
let canvasNow;
for (const scenario of SCENARIOS) {
	const key = `${scenario.canvas}@${scenario.zoom}`;
	if (canvasNow !== scenario.canvas) {
		await goCanvas(scenario.canvas);
		canvasNow = scenario.canvas;
		await quiet(1500);
	}
	const spot = busiest(scenario.canvas, scenario.zoom);
	await page.evaluate((z) => globalThis.__pan.zoomTo(z), scenario.zoom);
	await page.evaluate(({ x, y }) => globalThis.__pan.panTo(x, y), spot);
	await quiet(2000);
	const state = await page.evaluate(() => globalThis.__pan.state());
	// The pointer where a person's would be: the middle of the window, over a board when one is there.
	const point = { x: W / 2, y: H / 2 };
	const variants = AB ? ["off", "on"] : ["base"];
	const runs = Object.fromEntries(variants.map((v) => [v, []]));
	const traced = {};
	// Run -1 warms up, run 0 is traced, runs 1 to RUNS are counted.
	for (let run = -1; run <= RUNS; run++) {
		for (const v of variants) {
			// A key starting __ is a page global the code reads as it goes; any other a localStorage key.
			if (AB) await page.evaluate(({ k, on }) => (k.startsWith("__") ? (globalThis[k] = on) : on ? localStorage.setItem(k, "1") : localStorage.removeItem(k)), { k: AB, on: v === "on" });
			// The camera at rest between pans: code that reads the switch when a move starts reads it afresh.
			await quiet(400, 4000);
			const tracing = run === 0;
			if (tracing) await cdp.send("Tracing.start", { transferMode: "ReturnAsStream", traceConfig: { includedCategories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.frame", "gpu", "viz", "cc", "benchmark", "blink"] } });
			const profiling = PROFILE && run === 1;
			if (profiling) {
				await cdp.send("Profiler.enable");
				await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
				await cdp.send("Profiler.start");
			}
			const one = await pan(point);
			if (profiling) writeFileSync(`${PROFILE}.${key}.${v}.cpuprofile`, JSON.stringify((await cdp.send("Profiler.stop")).profile));
			if (tracing) {
				const done = new Promise((r) => cdp.once("Tracing.tracingComplete", r));
				await cdp.send("Tracing.end");
				const { stream } = await done;
				let data = "";
				for (;;) {
					const chunk = await cdp.send("IO.read", { handle: stream });
					data += chunk.data;
					if (chunk.eof) break;
				}
				await cdp.send("IO.close", { handle: stream });
				if (TRACE) writeFileSync(`${TRACE}.${key}.${v}.json`, data);
				const parsed = JSON.parse(data);
				traced[v] = { ...threadTimes(parsed.traceEvents ?? parsed, one.frames), tracedMissed: Math.round(one.missed * 1000) / 10 };
			}
			// A traced run is slower; it is not one of the runs counted.
			if (run >= 1) runs[v].push(one);
			// Back where the run started, at rest, so every run begins the same.
			await page.evaluate(({ x, y }) => globalThis.__pan.panTo(x, y), spot);
			await quiet(1200);
		}
	}
	const sum = Object.fromEntries(
		variants.map((v) => [v, { ...Object.fromEntries(Object.keys(runs[v][0]).map((k) => [k, k === "missed" ? Math.round(median(runs[v].map((r) => r[k])) * 1000) / 10 : r1(median(runs[v].map((r) => r[k])))])), trace: traced[v] }]),
	);
	result.scenarios[key] = { boardsInView: spot.n, ...state, ...sum };
	say(`${key} measured`, runs[variants[0]].length === RUNS, JSON.stringify(result.scenarios[key]));
}
result.setup = { throttle: THROTTLE, width: W, height: H, dpr: DPR, runs: RUNS, seconds: SECONDS, step: STEP, ab: AB, source: SOURCE, perfGrid: `${GRID}x${GRID} cells of ${CELL.w}x${CELL.h}` };
if (OUT) writeFileSync(OUT, JSON.stringify(result, null, "\t"));
say("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
process.exit(0);
