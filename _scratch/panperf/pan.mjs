// Pan profiler: node pan.mjs <stage> <zoom> <label> [--trace] [--headed]
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const API = process.env.API ?? "http://127.0.0.1:4651";
const [stageName = "decks-memo-design-kit-and-build", zoomArg = "0.25", label = "run"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const TRACE = process.argv.includes("--trace");
const HEADED = process.argv.includes("--headed");
const W = Number(process.env.W ?? 1440), H = Number(process.env.H ?? 900), DPR = Number(process.env.DPR ?? 2);
const FRAMES = Number(process.env.FRAMES ?? 240);
const DX = Number(process.env.DX ?? 10), DY = Number(process.env.DY ?? 4);

// Put the agent on the stage.
await new Promise((resolve) => {
	const ws = new WebSocket(API.replace("http", "ws") + "/ws");
	ws.onmessage = (e) => {
		const m = JSON.parse(e.data);
		if (m.type === "agents") {
			ws.send(JSON.stringify({ type: "agent.stage", id: m.chats[0].id, stage: stageName }));
			setTimeout(() => { ws.close(); resolve(); }, 800);
		}
	};
});

const browser = await chromium.launch({ headless: !HEADED, args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--enable-blink-features=CanvasDrawElement"] });
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(API + "/", { waitUntil: "load" });
await page.waitForFunction(() => window.__decksRust && window.__decksSheet, null, { timeout: 30000 });
await page.waitForTimeout(1500);

const zoomNow = () => page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector(".world")).transform).a);
const target = Number(zoomArg);
await page.mouse.move(W / 2, H / 2);
for (let i = 0; i < 200; i++) {
	const z = await zoomNow();
	if (Math.abs(Math.log(z / target)) < 0.03) break;
	await page.keyboard.down("Control");
	await page.mouse.wheel(0, z < target ? -Math.min(40, 400 * Math.log(target / z)) : Math.min(40, 400 * Math.log(z / target)));
	await page.keyboard.up("Control");
	await page.waitForTimeout(40);
}
await page.waitForTimeout(4000); // let live pages load and the camera rest
const info = await page.evaluate(() => ({
	zoom: new DOMMatrix(getComputedStyle(document.querySelector(".world")).transform).a,
	live: document.querySelector(".stage")?.dataset.live,
	iframes: document.querySelectorAll(".world iframe").length,
	visibleIframes: [...document.querySelectorAll(".world iframe")].filter((f) => { const r = f.getBoundingClientRect(); return r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight && getComputedStyle(f).visibility !== "hidden"; }).length,
	slots: document.querySelectorAll(".world > .board-slot").length,
	visibleSlots: [...document.querySelectorAll(".world > .board-slot")].filter((f) => { const r = f.getBoundingClientRect(); return r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight; }).length,
}));

const cdp = await context.newCDPSession(page);
if (process.env.THROTTLE) await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.THROTTLE) });
if (TRACE) {
	await cdp.send("Tracing.start", { transferMode: "ReturnAsStream", traceConfig: { includedCategories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.frame", "viz", "gpu", "cc", "blink", "toplevel", "benchmark", "disabled-by-default-viz.quads"] } });
}

// Pan: one wheel event per frame, as a trackpad does, back and forth so we stay over the boards.
const result = await page.evaluate(async ({ FRAMES, DX, DY }) => {
	const stage = document.querySelector(".stage");
	const r = stage.getBoundingClientRect();
	const times = [];
	const work = [];
	let longest = 0;
	const lof = [];
	const po = new PerformanceObserver((list) => { for (const e of list.getEntries()) lof.push({ d: e.duration, block: e.blockingDuration, render: e.renderStart ? e.startTime + e.duration - e.renderStart : 0 }); });
	try { po.observe({ type: "long-animation-frame", buffered: false }); } catch {}
	await new Promise((done) => {
		let i = 0;
		const step = (t) => {
			times.push(t);
			if (i >= FRAMES) return done();
			const dir = Math.floor(i / 60) % 2 ? -1 : 1;
			const s = performance.now();
			stage.dispatchEvent(new WheelEvent("wheel", { deltaX: DX * dir, deltaY: DY * dir, deltaMode: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }));
			work.push(performance.now() - s);
			i++;
			requestAnimationFrame(step);
		};
		requestAnimationFrame(step);
	});
	po.disconnect();
	const gaps = times.slice(1).map((t, i) => t - times[i]);
	return { gaps, work, lof };
}, { FRAMES, DX, DY });

if (TRACE) {
	const chunks = [];
	const done = new Promise((res) => cdp.once("Tracing.tracingComplete", res));
	await cdp.send("Tracing.end");
	const { stream } = await done;
	for (;;) {
		const { data, eof } = await cdp.send("IO.read", { handle: stream });
		chunks.push(data);
		if (eof) break;
	}
	writeFileSync(`/tmp/panperf-${label}.json`, chunks.join(""));
}

const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const g = result.gaps;
const total = g.reduce((a, b) => a + b, 0);
console.log(JSON.stringify({
	label, ...info,
	fps: +(1000 * g.length / total).toFixed(1),
	gapP50: +q(g, 0.5).toFixed(1), gapP90: +q(g, 0.9).toFixed(1), gapMax: +Math.max(...g).toFixed(1),
	over20: g.filter((x) => x > 20).length, frames: g.length,
	handlerP50: +q(result.work, 0.5).toFixed(2), handlerP90: +q(result.work, 0.9).toFixed(2),
	longFrames: result.lof.length, lofRenderP50: result.lof.length ? +q(result.lof.map((x) => x.render), 0.5).toFixed(1) : 0,
	errors: errors.slice(0, 3),
}));
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
await browser.close();
