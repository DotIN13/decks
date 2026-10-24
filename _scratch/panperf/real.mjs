// Real-input pan: CDP mouseWheel events over a live board, frames measured in the page.
// node real.mjs <stage> <zoom> <label>
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const API = process.env.API ?? "http://127.0.0.1:4651";
const [stageName, zoomArg = "0.23", label = "real"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const W = Number(process.env.W ?? 1440), H = Number(process.env.H ?? 900), DPR = Number(process.env.DPR ?? 2);
const STEPS = Number(process.env.STEPS ?? 500), EVERY = Number(process.env.EVERY ?? 8);
await new Promise((resolve) => {
	const ws = new WebSocket(API.replace("http", "ws") + "/ws");
	ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type === "agents") { ws.send(JSON.stringify({ type: "agent.stage", id: m.chats[0].id, stage: stageName })); setTimeout(() => { ws.close(); resolve(); }, 800); } };
});
const browser = await chromium.launch({ headless: !process.argv.includes("--headed"), args: ["--enable-unsafe-webgpu", "--use-angle=metal", "--enable-blink-features=CanvasDrawElement"] });
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
const page = await context.newPage();
await page.addInitScript((flags) => { if (window.top !== window.self) return; for (const f of flags) if (f) localStorage.setItem("pp." + f, "1"); }, (process.env.PP ?? "").split(","));
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
await page.waitForTimeout(4000);
await page.evaluate(() => { window.__pp = []; window.__ppPost = []; });
// Point at the middle of the biggest visible live iframe
const at = await page.evaluate(() => {
	let best; for (const f of document.querySelectorAll(".world iframe")) { const r = f.getBoundingClientRect(); const w = Math.min(r.right, innerWidth) - Math.max(r.left, 380), h = Math.min(r.bottom, innerHeight - 200) - Math.max(r.top, 80); if (w > 0 && h > 0 && (!best || w * h > best.a)) best = { a: w * h, x: Math.max(r.left, 380) + w / 2, y: Math.max(r.top, 80) + h / 2 }; }
	return best ?? { x: innerWidth / 2, y: innerHeight / 2 };
});
if (process.env.HIDEPAGES) await page.addStyleTag({ content: ".world iframe { visibility: hidden !important }" });
const cdp = await context.newCDPSession(page);
if (process.env.THROTTLE) await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.THROTTLE) });
const TRACE = process.argv.includes("--trace");
if (TRACE) await cdp.send("Tracing.start", { transferMode: "ReturnAsStream", traceConfig: { includedCategories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.frame", "viz", "gpu", "cc", "blink", "toplevel", "input", "benchmark", "latencyInfo", "disabled-by-default-v8.cpu_profiler"] } });
await page.evaluate(() => {
	const rec = (window.__rec = { t: [], m: [], s: [], f: [], l: [] });
	const world = document.querySelector(".world");
	const loop = (t) => { rec.t.push(t); rec.m.push(world.style.transform); rec.s.push(window.__decksSheet?.shown ?? 0); rec.f.push(document.querySelectorAll('.world iframe').length); rec.l.push(document.querySelectorAll('.world .board-node[data-loading], .world iframe:not([data-ready])').length); if (!rec.stop) requestAnimationFrame(loop); };
	requestAnimationFrame(loop);
});
import { spawn } from "node:child_process";
const idle = spawn("./gpu.sh", ["/tmp/gpu-idle.txt"]); await new Promise(r=>setTimeout(r,1500)); idle.kill();
const sampler = spawn("./gpu.sh", ["/tmp/gpu-pan.txt"]);
const t0 = Date.now();
for (let i = 0; i < STEPS; i++) {
	const dir = Math.floor(i / 50) % 2 ? -1 : 1;
	cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: at.x, y: at.y, deltaX: 10 * dir, deltaY: 4 * dir });
	const wait = t0 + (i + 1) * EVERY - Date.now();
	if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
sampler.kill();
await page.waitForTimeout(100);
const rec = await page.evaluate(() => { window.__rec.stop = true; return window.__rec; });
const pp = await page.evaluate(() => { const r = window.__pp ?? []; window.__pp = []; return r; });
const posts = await page.evaluate(() => { const r = window.__ppPost ?? []; window.__ppPost = []; return r; });
console.log('POSTS', JSON.stringify(posts));
console.log('WORKER', JSON.stringify(pp.map(p => `${p.n}t ${p.ms.toFixed(1)}ms${p.moving ? ' mv' : ''}`)));
if (TRACE) {
	const done = new Promise((res) => cdp.once("Tracing.tracingComplete", res));
	await cdp.send("Tracing.end");
	const { stream } = await done; const chunks = [];
	for (;;) { const { data, eof } = await cdp.send("IO.read", { handle: stream }); chunks.push(data); if (eof) break; }
	writeFileSync(`/tmp/panperf-${label}.json`, chunks.join(""));
}
const g = rec.t.slice(1).map((t, i) => t - rec.t[i]);
let changed = 0; for (let i = 1; i < rec.m.length; i++) if (rec.m[i] !== rec.m[i - 1]) changed++;
import { readFileSync as rf, rmSync } from 'node:fs';
const avg = (f) => { const v = rf(f,'utf8').trim().split('\n').map(Number).filter(n=>!isNaN(n)); rmSync(f); return +(v.reduce((a,b)=>a+b,0)/v.length).toFixed(0); };
const q = (a, p) => [...a].sort((x, y) => x - y)[Math.floor(p * (a.length - 1))];
const span = rec.t.at(-1) - rec.t[0];
console.log(JSON.stringify({ label, at, frames: g.length, fps: +(1000 * g.length / span).toFixed(1), moved: changed, movedPerSec: +(1000 * changed / span).toFixed(1), p50: +q(g, .5).toFixed(1), p90: +q(g, .9).toFixed(1), max: +Math.max(...g).toFixed(1), over20: g.filter((x) => x > 20).length, over33: g.filter((x) => x > 33).length, longSum: Math.round(g.filter((x) => x > 20).reduce((a, b) => a + b, 0)), inputSpanMs: Date.now() - t0, gpuIdle: avg('/tmp/gpu-idle.txt'), gpuPan: avg('/tmp/gpu-pan.txt') }));
const hitches = [];
for (let i = 1; i < rec.t.length; i++) { const gap = rec.t[i] - rec.t[i-1]; if (gap > 20) hitches.push({ i, gap: +gap.toFixed(0), draws: rec.s[i] - rec.s[i-1], iframes: `${rec.f[i-1]}->${rec.f[i]}`, drawsNear: rec.s[Math.min(i+2,rec.s.length-1)] - rec.s[Math.max(0,i-3)] }); }
console.log(JSON.stringify({ totalDraws: rec.s.at(-1) - rec.s[0], iframes: `${rec.f[0]}->${rec.f.at(-1)}`, hitches }));
await browser.close();
