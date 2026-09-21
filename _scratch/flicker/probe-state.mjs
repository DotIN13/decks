import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const logs = [];
page.on("console", (m) => logs.push(m.text().slice(0, 120)));
page.on("pageerror", (e) => logs.push("ERROR " + e.message.slice(0, 200)));
await page.goto("http://127.0.0.1:4327/#/stage", { waitUntil: "domcontentloaded" });
for (const t of [3000, 3000, 4000, 6000]) {
	await page.waitForTimeout(t);
	console.log(JSON.stringify(await page.evaluate(() => {
		const s = document.querySelector(".stage");
		return {
			nodes: document.querySelectorAll(".board-node").length,
			docs: document.querySelectorAll(".board-node iframe").length,
			placeholders: document.querySelectorAll(".board-node .placeholder").length,
			gliding: s?.dataset.gliding, scaling: s?.dataset.scaling, panning: s?.dataset.panning,
			transform: (document.querySelector(".world")?.style.transform ?? "").slice(0, 60),
		};
	})));
}
console.log("console:", logs.slice(0, 8));
await browser.close();
