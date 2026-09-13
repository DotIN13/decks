import { chromium } from "playwright";
const label = process.argv[2] ?? "before";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto("http://127.0.0.1:4327/", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".board-node iframe", { timeout: 20000 });
await page.waitForTimeout(2200);
await page.keyboard.press("0");
await page.waitForTimeout(900);
const narrow = await page.evaluate(() => {
	const nodes = [...document.querySelectorAll(".board-node")];
	const node = nodes.find((n) => Math.round(n.getBoundingClientRect().width) < 700) ?? nodes[0];
	node.querySelector(".chrome").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
	return node.dataset.path;
});
await page.locator(`.board-node[data-path="${narrow}"] .chrome`).dblclick();
await page.waitForTimeout(1000);
const spin = async (times) =>
	page.evaluate(({ n, path }) => {
		const bar = document.querySelector(`.board-node[data-path="${path}"] .chrome`).getBoundingClientRect();
		const stage = document.querySelector(".stage");
		const at = { x: bar.x + 60, y: bar.y + bar.height / 2 };
		for (let i = 0; i < n; i++) stage.dispatchEvent(new WheelEvent("wheel", { deltaY: -60, ctrlKey: true, clientX: at.x, clientY: at.y, bubbles: true, cancelable: true }));
	}, { n: times, path: narrow });
await spin(14);
await page.waitForTimeout(1400);
const info = await page.evaluate((path) => {
	const bar = document.querySelector(`.board-node[data-path="${path}"] .chrome`);
	const b = bar.getBoundingClientRect();
	const cs = getComputedStyle(bar);
	return { zoom: bar.style.getPropertyValue("--zoom"), willChange: cs.willChange, transform: cs.transform, bar: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } };
}, narrow);
console.log(JSON.stringify(info));
const clip = { x: Math.max(0, info.bar.x - 6), y: Math.max(0, info.bar.y), width: Math.min(1440 - Math.max(0, info.bar.x - 6), 620), height: info.bar.h };
await page.screenshot({ path: `/tmp/bar-${label}.png`, clip });
console.log("clip:", JSON.stringify(clip), "board:", narrow);
await browser.close();
