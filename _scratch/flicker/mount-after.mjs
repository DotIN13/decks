/** A board flown to must have its document once the camera stops. */
process.env.DECKS_E2E_WEB = "http://127.0.0.1:4430";
process.env.DECKS_E2E_API = "http://127.0.0.1:4430";
const { open, resetStage, settle, API } = await import("/home/decks/projects/decks/e2e/harness.mjs");
if (API !== "http://127.0.0.1:4430") throw new Error("wrong port");
const { browser, page, errors } = await open({ width: 1500, height: 1000, boards: false });
await page.addInitScript(() => { try { localStorage.setItem("decks.renderer", process?.env ? "dom" : "dom"); } catch {} });
await page.reload();
await resetStage(page);
await settle(page, 6000);

const onScreenWithout = () => page.evaluate(() => {
	const v = { w: innerWidth, h: innerHeight };
	return [...document.querySelectorAll(".board-node")].filter((n) => {
		const b = n.getBoundingClientRect();
		const seen = b.right > 0 && b.left < v.w && b.bottom > 0 && b.top < v.h;
		return seen && !n.querySelector("iframe");
	}).map((n) => n.dataset.path);
});
const state = () => page.evaluate(() => ({
	mounted: [...document.querySelectorAll(".board-node iframe")].map((f) => f.dataset.path),
	placeholders: [...document.querySelectorAll(".board-node .placeholder")].length,
	visible: [...document.querySelectorAll(".board-node")].length,
}));
const before = await state();
// Fly to the last row, and give the camera only the time the glide takes plus its settle.
await page.evaluate(() => [...document.querySelectorAll(".board-row")].at(-1)?.click());
await settle(page, 300);
const during = await state();
await settle(page, 1200);
const after = await state();
// And a wheel pan, which is the other kind of movement the rule holds documents back through.
await page.mouse.move(750, 500);
for (let i = 0; i < 30; i++) await page.mouse.wheel(0, 60);
const midPan = await state();
await settle(page, 1500);
const settled = await state();
// The case the rule is about: fly to a board that has never had a document.
const cold = await page.evaluate(() => {
	const withDoc = new Set([...document.querySelectorAll(".board-node iframe")].map((f) => f.dataset.path));
	const node = [...document.querySelectorAll(".board-node")].find((n) => !withDoc.has(n.dataset.path));
	return node?.dataset.path ?? null;
});
let coldResult = { path: cold, duringFly: null, afterFly: null };
if (cold) {
	await page.evaluate((path) => {
		const row = [...document.querySelectorAll(".board-row")].find((r) => r.textContent?.includes(path.replace("boards/", "").replace(".html", "")));
		(row ?? [...document.querySelectorAll(".board-row")][0]).click();
	}, cold);
	await page.waitForTimeout(220);
	coldResult.duringFly = await page.evaluate((p) => Boolean(document.querySelector(`.board-node[data-path="${p}"] iframe`)), cold);
	await page.waitForTimeout(2000);
	coldResult.afterFly = await page.evaluate((p) => Boolean(document.querySelector(`.board-node[data-path="${p}"] iframe`)), cold);
}
console.log(JSON.stringify({
	cold: coldResult,
	beforeFly: before.mounted.length, duringFly: during.mounted.length, afterFly: after.mounted.length,
	midPan: midPan.mounted.length, afterPan: settled.mounted.length,
	placeholdersAfterPan: settled.placeholders,
	onScreenWithoutDocumentAfterPan: await onScreenWithout(),
}, null, 1));
console.log("errors", errors.slice(0, 3));
await browser.close();
