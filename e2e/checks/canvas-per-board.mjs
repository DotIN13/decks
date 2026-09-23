/**
 * The "Canvas" renderer (Settings → Boards, `canvas-per-board` in code), which draws each board into a canvas of
 * its own with Chrome's HTML-in-Canvas API (`board/BoardFrame.tsx`, `canvas/picture.ts`).
 *
 * It is an option and stays one, so it is checked here rather than only by eye: a board's picture
 * is never blank while the canvas moves — it used to be wiped by a redraw of a board off screen,
 * whose snapshot Chrome leaves empty — clicks still reach a board's page, and a scroll over a
 * board still pans. Needs no model.
 */
import { open, resetStage, say, settle } from "../harness.mjs";

await resetStage();
const { browser, page, context, errors } = await open({ width: 1400, height: 900 });
// After the harness's own script, which clears storage on every load.
await context.addInitScript(() => {
	if (window.top === window.self) localStorage.setItem("decks.renderer", "canvas-per-board");
});
await page.reload();
await settle(page, 5000);
say("the renderer is on", (await page.evaluate(() => document.querySelector(".stage")?.dataset.renderer)) === "canvas-per-board");
say("each board is a canvas with its page inside it", (await page.locator(".board-node canvas.picture iframe").count()) > 0);

const node = page.locator(".board-node").first();
await page.locator(`.bar-layer .chrome[data-path="${await page.evaluate(() => document.querySelector(".board-node").dataset.path)}"]`).click();
await page.keyboard.press("1");
await settle(page, 2500);
await page.mouse.click(1395, 895);
await settle(page, 1200);

/** Per frame, whether the first board's picture has anything in it. */
await page.evaluate(() => {
	window.__blank = [];
	const probe = Object.assign(document.createElement("canvas"), { width: 8, height: 8 });
	const ctx = probe.getContext("2d", { willReadFrequently: true });
	const picture = document.querySelector(".board-node canvas.picture");
	const tick = () => {
		ctx.clearRect(0, 0, 8, 8);
		ctx.drawImage(picture, 0, 0, 8, 8);
		const data = ctx.getImageData(0, 0, 8, 8).data;
		let any = false;
		for (let i = 3; i < data.length; i += 4) if (data[i] > 0) any = true;
		window.__blank.push(any ? "." : "X");
		if (window.__blank.length < 400) requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
});
await page.mouse.move(700, 450);
for (let i = 0; i < 6; i++) {
	await page.mouse.wheel(900, 0);
	await page.waitForTimeout(30);
}
await settle(page, 2500);
for (let i = 0; i < 6; i++) {
	await page.mouse.wheel(-900, 0);
	await page.waitForTimeout(30);
}
await settle(page, 2000);
const frames = await page.evaluate(() => window.__blank.join(""));
say("a board's picture stays drawn when it is panned off screen and back", !frames.includes("X"), `${(frames.match(/X/g) ?? []).length} blank frames of ${frames.length}`);

const box = await node.locator(".surface").boundingBox();
await node.evaluate((n) => {
	const doc = n.querySelector("iframe").contentDocument;
	doc.__presses = 0;
	doc.addEventListener("pointerdown", () => (doc.__presses += 1), true);
});
await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.6);
await settle(page, 300);
say("a click on a board reaches its page", (await node.evaluate((n) => n.querySelector("iframe").contentDocument.__presses)) === 1);

const camera = () => page.evaluate(() => getComputedStyle(document.querySelector(".world")).transform);
const before = await camera();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.wheel(0, 40);
await settle(page, 300);
say("a scroll over a board pans the canvas", (await camera()) !== before);

say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
