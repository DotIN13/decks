import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
await page.goto("http://127.0.0.1:4327/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".board-node iframe", { timeout: 20000 });
await page.waitForTimeout(2000);
await page.keyboard.press("0");
await page.waitForTimeout(900);
// zoom the camera in hard: the bar is counter-scaled, so this is the blur case
for (let i = 0; i < 9; i++) { await page.keyboard.press("Control+Equal"); await page.waitForTimeout(120); }
await page.waitForTimeout(700);
const info = await page.evaluate(() => {
	const node = document.querySelector(".board-node");
	const bar = node.querySelector(".chrome");
	const r = (el) => { const b = el.getBoundingClientRect(); return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1), bottom: +b.bottom.toFixed(1) }; };
	const parts = { title: node.querySelector(".chrome .title"), file: node.querySelector(".chrome .file"), acts: node.querySelector(".chrome .acts") };
	const buttons = [...node.querySelectorAll(".chrome .acts > *")].map((el) => ({ cls: el.className, ...r(el) }));
	return { bar: r(bar), zoom: bar.style.getPropertyValue("--zoom"), parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v ? r(v) : null])), buttons };
});
console.log(JSON.stringify(info, null, 1));
const box = await page.locator(".board-node .chrome").first().boundingBox();
await page.screenshot({ path: "/tmp/bar-blur.png", clip: { x: box.x, y: box.y, width: Math.min(560, box.width), height: box.height } });
console.log("clip:", JSON.stringify({ w: Math.round(box.width), h: Math.round(box.height) }));
await browser.close();
