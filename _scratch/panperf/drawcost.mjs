// Cost of the page canvas's full redraw: call draw() once per frame at rest, measure frame gaps.
import { chromium } from "playwright";
const API = process.env.API ?? "http://127.0.0.1:4651";
const [stageName, zoomArg = "0.6"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const W = Number(process.env.W ?? 1440), H = Number(process.env.H ?? 900);
await new Promise((resolve) => { const ws = new WebSocket(API.replace("http", "ws") + "/ws"); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type === "agents") { ws.send(JSON.stringify({ type: "agent.stage", id: m.chats[0].id, stage: stageName })); setTimeout(() => { ws.close(); resolve(); }, 800); } }; });
const browser = await chromium.launch({ headless: !process.argv.includes("--headed"), args: ["--enable-unsafe-webgpu", "--use-angle=metal"] });
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
const page = await context.newPage();
await page.goto(API + "/"); await page.waitForFunction(() => window.__decksRust && window.__decksSheet, null, { timeout: 30000 });
await page.waitForTimeout(1500);
const zoomNow = () => page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector(".world")).transform).a);
const target = Number(zoomArg); await page.mouse.move(W / 2, H / 2);
for (let i = 0; i < 200; i++) { const z = await zoomNow(); if (Math.abs(Math.log(z / target)) < 0.03) break; await page.keyboard.down("Control"); await page.mouse.wheel(0, z < target ? -Math.min(40, 400 * Math.log(target / z)) : Math.min(40, 400 * Math.log(z / target))); await page.keyboard.up("Control"); await page.waitForTimeout(40); }
await page.waitForTimeout(4000);
import { spawn } from 'node:child_process'; import { readFileSync, rmSync, existsSync } from 'node:fs';
for (const mode of (process.env.MODES ?? "idle,draw").split(",")) {
	if (existsSync('/tmp/gpu-dc.txt')) rmSync('/tmp/gpu-dc.txt'); const sampler = spawn('./gpu.sh', ['/tmp/gpu-dc.txt']);
	const r = await page.evaluate(async (mode) => {
		const e = window.__decksRust; const times = []; const cpu = [];
		await new Promise((done) => { let i = 0; const step = (t) => { times.push(t); if (i++ >= 240) return done(); if (mode === "draw" || (mode === "sparse" && i % 36 === 0)) { const s = performance.now(); e.draw(); cpu.push(performance.now() - s); } requestAnimationFrame(step); }; requestAnimationFrame(step); });
		const g0 = times.slice(1).map((t, i) => t - times[i]); const after = mode === "sparse" ? g0.filter((_, i) => i % 36 === 1 || i % 36 === 2).map((x) => x.toFixed(0)).join(" ") : ""; const g = [...g0].sort((a, b) => a - b);
		const c = e.over; return { after, max: g.at(-1).toFixed(0), p50: g[g.length >> 1].toFixed(1), p90: g[Math.floor(g.length * 0.9)].toFixed(1), cpu: cpu.length ? (cpu.reduce((a, b) => a + b) / cpu.length).toFixed(2) : 0, canvas: c ? `${c.width}x${c.height}` : "?" };
	}, mode);
	sampler.kill(); const v = readFileSync('/tmp/gpu-dc.txt','utf8').trim().split('\n').map(Number).filter(n=>!isNaN(n)); r.gpu = Math.round(v.reduce((a,b)=>a+b,0)/v.length);
	console.log(process.env.LABEL ?? '', W + "x" + H, mode, JSON.stringify(r));
}
await browser.close();
