#!/usr/bin/env node
/**
 * Pinch a card-heavy canvas in a simulated iPad and print what the pinches cost, as one JSON object.
 *
 *   node scripts/card-zoom.mjs [--url http://127.0.0.1:4876] [--canvas studio-cards] [--engine chromium|webkit]
 *                              [--device "iPad Pro 11"] [--throttle 4] [--pinches 3] [--out file.json]
 *
 * Opens the harness at `url` (its web root: a new browser lands on the conversation focused last,
 * so focus one on a card-heavy canvas first) in Playwright with an iPad's descriptor (its user agent,
 * touch, 2× pixels and viewport), says it has five touch points so the canvas counts it as an iPad
 * (`render/device.ts`: a "Mac" with a touch screen), and in Chromium slows the CPU 4× through CDP.
 * Then it goes to the middle of the cards at 100% and pinches 100% → 20% → 100% `--pinches` times.
 *
 * The pinch is two real fingers in Chromium (CDP `Input.dispatchTouchEvent`, which reaches the stage as
 * touch and pointer events, so the canvas's own two-finger pinch moves the camera), and Safari's gesture
 * events in WebKit, which has no CDP (`stage/input.ts`, the same events a trackpad pinch sends there).
 *
 * For each pinch: frames drawn and dropped (an animation frame more than 20 ms after the one before, in
 * the canvas frame), cards mounted and unmounted while the fingers were down (a `.card-host` is made
 * for each mount, `card-surface.tsx`, and goes with its slot), and, once the camera rests, the cards
 * live and the JS heap (after a collection); at the end, the cards live at rest at 60% and 45%. In Chromium also the main thread's work while the fingers
 * were down (`Performance.getMetrics`), since a slowed headless page does not always show it as late
 * frames. WebKit is for correctness: no throttle, no heap.
 */
import { chromium, devices, webkit } from "playwright";
import { writeFileSync } from "node:fs";

const arg = (name, fallback) => {
	const at = process.argv.indexOf(`--${name}`);
	return at > 0 ? process.argv[at + 1] : fallback;
};
const url = arg("url", "http://127.0.0.1:4876");
const engine = arg("engine", "chromium");
const deviceName = arg("device", "iPad Pro 11");
const throttle = Number(arg("throttle", engine === "chromium" ? "4" : "1"));
const pinches = Number(arg("pinches", "3"));
const out = arg("out");
const descriptor = devices[deviceName];
if (!descriptor) throw new Error(`playwright has no device called "${deviceName}"`);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const gpu = ["--enable-unsafe-webgpu", ...(process.platform === "darwin" ? ["--use-angle=metal"] : ["--enable-unsafe-swiftshader"])];
const browser = engine === "webkit" ? await webkit.launch() : await chromium.launch({ headless: process.env.HEADED !== "1", args: [...gpu, "--enable-precise-memory-info"] });
const context = await browser.newContext({ ...descriptor });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

/*
 * In every frame, before the app: five touch points (an iPad says it is a Mac with a touch screen),
 * and in the canvas frame the counters, an animation-frame clock and a watch on card hosts.
 */
await page.addInitScript(() => {
	Object.defineProperty(Navigator.prototype, "maxTouchPoints", { get: () => 5, configurable: true });
	if (!location.href.includes("canvas-frame")) return;
	const cz = { mounts: 0, unmounts: 0, frames: [], recording: false };
	globalThis.__cz = cz;
	let last = 0;
	const tick = (t) => {
		if (cz.recording && last) cz.frames.push(t - last);
		last = t;
		requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
	const hosts = (node) => (node.nodeType !== 1 ? 0 : (node.matches(".card-host") ? 1 : 0) + node.querySelectorAll(".card-host").length);
	const watch = () =>
		new MutationObserver((records) => {
			for (const record of records) {
				for (const node of record.addedNodes) cz.mounts += hosts(node);
				for (const node of record.removedNodes) cz.unmounts += hosts(node);
			}
		}).observe(document.documentElement, { childList: true, subtree: true });
	if (document.documentElement) watch();
	else document.addEventListener("DOMContentLoaded", watch);
});

/*
 * `--canvas <name>`: the conversation on that canvas is focused first (one is made when none is), so
 * this browser lands there.
 */
const canvasName = arg("canvas");
if (canvasName) {
	const { asPerson, socket } = await import("../e2e/harness.mjs");
	const person = await asPerson(url);
	const call = async (verb, ...args) => (await (await fetch(`${url}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...person }, body: JSON.stringify({ args }) })).json()).value;
	const agent = (await call("agent.list")).find((one) => one.canvas === canvasName) ?? (await call("agent.create", { name: `Zoom ${canvasName}`, canvas: canvasName, kind: "claude" }));
	const link = await socket(url);
	await sleep(300);
	link.send({ type: "agent.focus", id: agent.id });
	await sleep(600);
	link.close();
}
await page.goto(`${url}/`, { waitUntil: "load" });
const findFrame = async () => {
	for (let i = 0; i < 300; i++) {
		const frame = page.frames().find((one) => !one.isDetached() && one.url().includes("canvas-frame"));
		if (frame && (await frame.evaluate(() => !!document.querySelector(".stage") && (globalThis.__decksBoards?.().length ?? 0) > 0).catch(() => false))) return frame;
		await sleep(100);
	}
	throw new Error("the canvas frame never showed its stage with items on it");
};
const canvas = await findFrame();

// The CDP sessions to slow: the page's, and the canvas frame's when it runs in a process of its own.
const sessions = [];
let frameSession;
if (engine === "chromium") {
	sessions.push(await context.newCDPSession(page));
	try {
		frameSession = await context.newCDPSession(canvas);
		sessions.push(frameSession);
	} catch {
		/* the frame shares the page's process */
	}
	for (const session of sessions) await session.send("Emulation.setCPUThrottlingRate", { rate: throttle });
	await (frameSession ?? sessions[0]).send("Performance.enable");
}
/** The main thread's work so far, in ms (Chromium's `Performance.getMetrics`): tasks, scripts, layout and style. */
const work = async () => {
	if (engine !== "chromium") return {};
	const { metrics } = await (frameSession ?? sessions[0]).send("Performance.getMetrics");
	const get = (name) => (metrics.find((m) => m.name === name)?.value ?? 0) * 1000;
	return { task: get("TaskDuration"), script: get("ScriptDuration"), layout: get("LayoutDuration"), style: get("RecalcStyleDuration") };
};

const device = await canvas.evaluate(() => {
	const apple = /iPhone|iPad|iPod/.test(navigator.platform) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
	return { kind: apple || /Android/i.test(navigator.userAgent) ? "mobile" : "computer", platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints, dpr: devicePixelRatio, w: innerWidth, h: innerHeight };
});
if (device.kind !== "mobile") throw new Error(`the canvas would count this as a ${device.kind}: ${JSON.stringify(device)}`);

const zoomNow = () => canvas.evaluate(() => Number(/scale\(([\d.]+)\)/.exec(String(globalThis.__decksCameraTransform?.()))?.[1] ?? NaN));
const atRest = async (timeout = 15000) => {
	await sleep(200);
	await canvas
		.waitForFunction(() => {
			const stage = document.querySelector(".stage")?.dataset;
			return stage && stage.moving !== "true" && stage.gliding !== "true" && stage.scaling !== "true";
		}, null, { timeout, polling: 100 })
		.catch(() => {});
};
/** Wait for the cards to stop coming and going: the same count of hosts for `quiet` ms. */
const settled = async (quiet = 1500, timeout = 20000) => {
	const end = Date.now() + timeout;
	let was = -1;
	let since = Date.now();
	while (Date.now() < end) {
		const now = await canvas.evaluate(() => `${__cz.mounts}/${__cz.unmounts}`);
		if (now !== was) {
			was = now;
			since = Date.now();
		} else if (Date.now() - since >= quiet) return;
		await sleep(150);
	}
};
const stageBox = await canvas.evaluate(() => {
	const r = document.querySelector(".stage").getBoundingClientRect();
	return { x: r.left, y: r.top, w: r.width, h: r.height };
});
const middle = { x: stageBox.x + stageBox.w / 2, y: stageBox.y + stageBox.h / 2 };

/** One pinch from the current zoom by `factor`, about the middle of the stage, over `ms`. */
const pinch = async (factor, ms = 900) => {
	if (engine === "webkit") {
		await canvas.evaluate(
			async ([factor, ms, x, y]) => {
				const stage = document.querySelector(".stage");
				const fire = (type, scale) => stage.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), { scale, clientX: x, clientY: y }));
				const start = performance.now();
				fire("gesturestart", 1);
				for (;;) {
					const t = Math.min(1, (performance.now() - start) / ms);
					fire("gesturechange", 1 + (factor - 1) * t);
					if (t >= 1) break;
					await new Promise((done) => requestAnimationFrame(done));
				}
				__cz.recording = false;
				__cz.down = { mounts: __cz.mounts, unmounts: __cz.unmounts };
				fire("gestureend", factor);
			},
			[factor, ms, middle.x, middle.y],
		);
		return;
	}
	const cdp = sessions[0];
	// The fingers' spread goes from `a` to `b`, and the canvas zooms by b / a.
	const room = Math.min(stageBox.w, stageBox.h) * 0.8;
	const [a, b] = factor < 1 ? [room, room * factor] : [room / factor, room];
	const points = (spread) => [
		{ x: middle.x - spread / 2, y: middle.y, id: 1, radiusX: 2, radiusY: 2, force: 1 },
		{ x: middle.x + spread / 2, y: middle.y, id: 2, radiusX: 2, radiusY: 2, force: 1 },
	];
	await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(a) });
	const start = Date.now();
	for (;;) {
		const t = Math.min(1, (Date.now() - start) / ms);
		// Even in log space, so each step zooms by the same ratio.
		await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points(a * (b / a) ** t) });
		if (t >= 1) break;
		await sleep(16);
	}
	// What happened while the fingers were down, read before they lift: the lift itself ends the gesture.
	await canvas.evaluate(() => {
		__cz.recording = false;
		__cz.down = { mounts: __cz.mounts, unmounts: __cz.unmounts };
	});
	await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
};

/** Reach a zoom in pinches no bigger than 4× each. */
const zoomTo = async (want) => {
	for (let i = 0; i < 6; i++) {
		const now = await zoomNow();
		if (Math.abs(now / want - 1) < 0.03) return;
		await pinch(Math.min(4, Math.max(1 / 4, want / now)), 500);
		await atRest();
	}
};

const heap = async () => {
	if (engine !== "chromium") return undefined;
	// After a collection, so a reading is what is held, not what is waiting for the collector.
	await (frameSession ?? sessions[0]).send("HeapProfiler.collectGarbage");
	if (frameSession) return Math.round(((await frameSession.send("Runtime.getHeapUsage")).usedSize / 2 ** 20) * 10) / 10;
	return canvas.evaluate(() => Math.round((performance.memory?.usedJSHeapSize ?? 0) / 2 ** 20 * 10) / 10);
};
const live = () =>
	canvas.evaluate(() => {
		const hosts = [...document.querySelectorAll(".card-host")];
		const r = document.querySelector(".stage").getBoundingClientRect();
		const shown = hosts.filter((host) => {
			const b = host.getBoundingClientRect();
			return getComputedStyle(host).visibility !== "hidden" && b.right > r.left && b.left < r.right && b.bottom > r.top && b.top < r.bottom;
		});
		return { live: hosts.length, onScreen: shown.length, cards: (globalThis.__decksBoards?.() ?? []).length };
	});

// Settle after the open, then go to the middle of the cards: the stage scrolls (a pan), then pinches to 100%.
await atRest();
await settled(2500, 30000);
await canvas.evaluate(() => {
	const rects = (globalThis.__decksBoards?.() ?? []).map((one) => one.rect);
	const xs = rects.map((r) => r.left + r.width / 2).sort((p, q) => p - q);
	const ys = rects.map((r) => r.top + r.height / 2).sort((p, q) => p - q);
	const stage = document.querySelector(".stage");
	const s = stage.getBoundingClientRect();
	stage.scrollBy({ left: xs[xs.length >> 1] - (s.left + s.width / 2), top: ys[ys.length >> 1] - (s.top + s.height / 2), behavior: "instant" });
});
await atRest();
await zoomTo(1);
await atRest();
await settled(2000, 30000);
const start = { zoom: await zoomNow(), heapMB: await heap(), ...(await live()) };

const runs = [];
const gesture = async (name, factor) => {
	const before = await canvas.evaluate(() => {
		__cz.frames = [];
		__cz.recording = true;
		return { mounts: __cz.mounts, unmounts: __cz.unmounts };
	});
	const w0 = await work();
	const t0 = Date.now();
	await pinch(factor);
	const ms = Date.now() - t0;
	const during = await canvas.evaluate(() => ({ ...__cz.down, frames: __cz.frames }));
	const w1 = await work();
	const busy = Object.fromEntries(Object.keys(w1).map((key) => [key, Math.round(w1[key] - w0[key])]));
	await atRest();
	await settled();
	const after = await canvas.evaluate(() => ({ mounts: __cz.mounts, unmounts: __cz.unmounts }));
	const frames = during.frames;
	const sorted = [...frames].sort((p, q) => p - q);
	runs.push({
		name,
		ms,
		frames: frames.length,
		dropped: frames.filter((f) => f > 20).length,
		worstMs: Math.round(sorted.at(-1) ?? 0),
		p95Ms: Math.round(sorted[Math.floor(sorted.length * 0.95)] ?? 0),
		// The main thread's work while the fingers were down (Chromium), in ms: a slowed CPU at 4× does not always show it as late frames headless.
		busyMs: busy,
		mounts: during.mounts - before.mounts,
		unmounts: during.unmounts - before.unmounts,
		mountsAfter: after.mounts - during.mounts,
		unmountsAfter: after.unmounts - during.unmounts,
		zoom: Math.round((await zoomNow()) * 1000) / 1000,
		heapMB: await heap(),
		...(await live()),
	});
};
for (let i = 0; i < pinches; i++) {
	await gesture("out", 0.2);
	await gesture("in", 5);
}

// Live cards at rest at a few zooms between: where the most cards are near enough to wake.
const stops = [];
for (const want of [0.6, 0.45]) {
	await zoomTo(want);
	await atRest();
	await settled();
	stops.push({ zoom: Math.round((await zoomNow()) * 1000) / 1000, heapMB: await heap(), ...(await live()) });
}

const sum = (key, list = runs) => list.reduce((n, run) => n + run[key], 0);
const report = {
	engine,
	device: deviceName,
	throttle,
	at: device,
	start,
	summary: {
		pinches: runs.length,
		droppedPerPinch: Math.round((sum("dropped") / runs.length) * 10) / 10,
		droppedShare: Math.round((sum("dropped") / Math.max(1, sum("frames"))) * 1000) / 1000,
		mountsPerPinch: Math.round(((sum("mounts") + sum("unmounts")) / runs.length) * 10) / 10,
		liveAt100: Math.max(...runs.filter((run) => run.name === "in").map((run) => run.live)),
		liveAt20: Math.max(...runs.filter((run) => run.name === "out").map((run) => run.live)),
		heapMB: Math.max(...runs.map((run) => run.heapMB ?? 0)),
		liveMost: Math.max(...stops.map((stop) => stop.live), ...runs.map((run) => run.live)),
		busyMsPerPinch: engine === "chromium" ? Math.round(runs.reduce((n, run) => n + run.busyMs.task, 0) / runs.length) : undefined,
		scriptMsPerPinch: engine === "chromium" ? Math.round(runs.reduce((n, run) => n + run.busyMs.script, 0) / runs.length) : undefined,
	},
	runs,
	stops,
	errors: errors.slice(0, 10),
};
console.log(JSON.stringify(report, null, "\t"));
if (out) writeFileSync(out, JSON.stringify(report, null, "\t"));
await browser.close();
