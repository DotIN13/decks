import { chromium } from "playwright";
const [api, out, stageName, zoomArg] = process.argv.slice(2);
await new Promise((resolve) => { const ws = new WebSocket(api.replace("http", "ws") + "/ws"); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type === "agents") { ws.send(JSON.stringify({ type: "agent.stage", id: m.chats[0].id, stage: stageName })); setTimeout(() => { ws.close(); resolve(); }, 800); } }; });
const browser = await chromium.launch({ args: ["--enable-unsafe-webgpu", "--use-angle=metal"] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage();
await page.goto(api + "/"); await page.waitForFunction(() => window.__decksRust && window.__decksSheet, null, { timeout: 30000 });
await page.waitForTimeout(1500);
const target = Number(zoomArg); await page.mouse.move(720, 450);
const zoomNow = () => page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector(".world")).transform).a);
for (let i = 0; i < 200; i++) { const z = await zoomNow(); if (Math.abs(Math.log(z / target)) < 0.03) break; await page.keyboard.down("Control"); await page.mouse.wheel(0, z < target ? -Math.min(40, 400 * Math.log(target / z)) : Math.min(40, 400 * Math.log(z / target))); await page.keyboard.up("Control"); await page.waitForTimeout(40); }
await page.waitForTimeout(6000);
// only the engine's canvas
const png = await page.locator("canvas.stage-engine-over").screenshot();
(await import("node:fs")).writeFileSync(out, png);
console.log(await page.evaluate(() => JSON.stringify(window.__decksRust.camera)));
await browser.close();
