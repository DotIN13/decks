process.env.DECKS_E2E_WEB = "http://127.0.0.1:4430";
process.env.DECKS_E2E_API = "http://127.0.0.1:4430";
const { open, resetStage, settle, API } = await import("/home/decks/projects/decks/e2e/harness.mjs");
if (API !== "http://127.0.0.1:4430") throw new Error("wrong port");
const { browser, page, errors } = await open({ width: 1500, height: 1000, boards: false });
await page.reload();
await resetStage(page);
await settle(page, 6000);
const snap = () => page.evaluate(() => {
	const stage = document.querySelector(".stage");
	return {
		docs: document.querySelectorAll(".board-node iframe").length,
		visible: [...document.querySelectorAll(".board-node")].filter((n) => { const b = n.getBoundingClientRect(); return b.right > 0 && b.left < innerWidth && b.bottom > 0 && b.top < innerHeight; }).length,
		gliding: stage.dataset.gliding, scaling: stage.dataset.scaling, panning: stage.dataset.panning,
	};
});
console.log("before   ", JSON.stringify(await snap()));
await page.evaluate(() => [...document.querySelectorAll(".board-row")].at(-1)?.click());
for (const ms of [200, 400, 800, 1500, 3000, 5000]) {
	await page.waitForTimeout(ms === 200 ? 200 : 0);
	if (ms !== 200) await page.waitForTimeout(ms - 200 <= 0 ? 0 : 0);
	console.log(`t=${ms}`.padEnd(9), JSON.stringify(await snap()));
	await page.waitForTimeout(ms === 200 ? 200 : 400);
}
await page.waitForTimeout(4000);
console.log("settled  ", JSON.stringify(await snap()));
console.log("errors", errors.slice(0, 3));
await browser.close();
