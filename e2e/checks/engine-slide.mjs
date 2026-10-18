/**
 * A pan slides the engine's canvas instead of drawing it again.
 *
 * The engine's canvas is drawn for the window and a margin round it (`stage/engine.ts`, `SLACK_PX`).
 * While the camera moves at one zoom it is moved with the world, and drawn again only when the window
 * reaches its edge, the zoom changes, or the camera comes to rest. Drawing the whole window on every
 * pan step was most of a pan's time on the GPU.
 */
import { open, resetStage, say, settle } from "../harness.mjs";

await resetStage();
const { browser, page, errors } = await open({ width: 1400, height: 900, dpr: 2 });
await settle(page, 1500);
await page.waitForFunction(() => window.__decksRust && window.__decksSheet, null, { timeout: 15000 });

const draws = () => page.evaluate(() => window.__decksSheet.shown ?? 0);
/** Whether the canvas covers the whole window, as it must between draws. */
const covers = () =>
	page.evaluate(() => {
		const r = document.querySelector("canvas.stage-engine-over").getBoundingClientRect();
		return r.left <= 0.5 && r.top <= 0.5 && r.right >= innerWidth - 0.5 && r.bottom >= innerHeight - 0.5;
	});

const size = await page.evaluate(() => {
	const c = document.querySelector("canvas.stage-engine-over");
	return { w: c.width, h: c.height, css: c.getBoundingClientRect().width };
});
say("the canvas is the window and a margin on each side", size.css > 1400 + 100 && size.w === Math.round(size.css * 2), JSON.stringify(size));

await page.mouse.move(700, 450);
const before = await draws();
let gaps = 0;
for (let i = 0; i < 20; i++) {
	await page.mouse.wheel(6, 4);
	await page.waitForTimeout(16);
	if (!(await covers())) gaps++;
}
const during = (await draws()) - before;
say("twenty small pan steps draw the canvas only a few times", during <= 4, `${during} draws`);
say("the slid canvas covers the window at every step", gaps === 0, `${gaps} steps with a gap`);

for (let i = 0; i < 30; i++) {
	await page.mouse.wheel(60, 0);
	await page.waitForTimeout(16);
	if (!(await covers())) gaps++;
}
say("a long pan draws again as the margin runs out, and still covers the window", gaps === 0 && (await draws()) - before > during, `${(await draws()) - before} draws`);

const moved = await draws();
await settle(page, 600);
say("at rest it is drawn once more, centred", (await draws()) > moved && (await covers()));

say("no errors on the page", errors.length === 0, errors.join(" | "));
await browser.close();
