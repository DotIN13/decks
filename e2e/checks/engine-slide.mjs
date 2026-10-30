/**
 * A pan is the browser scrolling a sheet already drawn.
 *
 * The stage scrolls natively (`camera/scroll-area.ts`), so the engine's canvas is a sheet: the window
 * and a quarter of it on each side (`render/engine.ts`, `SHEET_MARGIN`, `drawRect`), drawn round the
 * camera and scrolled with the world. A pan inside the sheet draws nothing; the sheet is drawn again
 * only when the window reaches its edge, the zoom changes, or the camera rests, where it is centred
 * again. What this holds: the sheet's size, no draws for a short pan, a draw when a long one leaves the
 * sheet, a cheap draw, and the window covered at every step.
 */
import { canvasFrame, open, resetStage, rest, say, settle } from "../harness.mjs";

await resetStage();
const { browser, page, errors } = await open({ width: 1400, height: 900, dpr: 2 });
// The canvas and its engine are in the canvas frame.
const canvas = await canvasFrame(page);
await settle(page, 1500);
await canvas.waitForFunction(() => window.__decksRust?.page && window.__decksSheet, null, { timeout: 15000 });

const draws = () => canvas.evaluate(() => window.__decksSheet.shown ?? 0);
/** Whether the canvas covers the whole window, as it must at every frame: the sheet holds the window inside it. */
const covers = () =>
	canvas.evaluate(() => {
		const r = document.querySelector("canvas.stage-engine-over").getBoundingClientRect();
		return r.left <= 0.5 && r.top <= 0.5 && r.right >= innerWidth - 0.5 && r.bottom >= innerHeight - 0.5;
	});

const size = await canvas.evaluate(() => {
	const c = document.querySelector("canvas.stage-engine-over");
	return { w: c.width, h: c.height, css: c.getBoundingClientRect().width };
});
say("the canvas is the window and a quarter of it on each side", Math.abs(size.css - 2100) < 1 && size.w === 4200 && size.h === 2700, JSON.stringify(size));

// The page's time in each draw, from here on.
await canvas.evaluate(() => {
	const engine = window.__decksRust.page;
	const frame = Object.getPrototypeOf(engine).frame;
	window.__slideMs = [];
	engine.frame = function (...args) {
		const t = performance.now();
		const out = frame.apply(this, args);
		window.__slideMs.push(performance.now() - t);
		return out;
	};
});

await page.mouse.move(700, 450);
const before = await draws();
let gaps = 0;
for (let i = 0; i < 20; i++) {
	await page.mouse.wheel(6, 4);
	await page.waitForTimeout(16);
	if (!(await covers())) gaps++;
}
const during = (await draws()) - before;
// 120 by 80 px in all, inside the sheet's 350 by 225 px margin: the browser scrolls what is drawn.
say("twenty small pan steps inside the sheet draw nothing", during <= 1, `${during} draws`);
say("the canvas covers the window at every step", gaps === 0, `${gaps} steps with a gap`);

const beforeLong = await draws();
for (let i = 0; i < 30; i++) {
	await page.mouse.wheel(60, 0);
	await page.waitForTimeout(16);
	if (!(await covers())) gaps++;
}
const long = (await draws()) - beforeLong;
say("a long pan still covers the window at every step", gaps === 0, `${gaps} steps with a gap`);
// 1,800 px: past the sheet's edge more than once, and each time it is drawn round the camera again, not every step.
say("…drawing the sheet again as the window reaches its edge, not at every step", long >= 1 && long < 30, `${long} draws`);
const ms = await canvas.evaluate(() => [...window.__slideMs].sort((a, b) => a - b));
const median = ms[Math.floor(ms.length / 2)] ?? Infinity;
say("a pan frame is one cheap draw: the page's median draw under 2 ms", median < 2, `${median.toFixed(2)} ms over ${ms.length} draws`);

await canvas.waitForFunction(() => document.querySelector(".stage")?.dataset.moving === "true", null, { timeout: 300 }).catch(() => {});
const moved = await draws();
await rest(page, { start: 0 });
await settle(page, 100);
say("at rest it is drawn once more, over the window", (await draws()) > moved && (await covers()));

// The world is one layer while it slides at one zoom, and never across a change of scale or at rest.
const layer = () => canvas.evaluate(() => getComputedStyle(document.querySelector(".world")).willChange);
const states = [];
for (let i = 0; i < 6; i++) {
	await page.mouse.wheel(8, 4);
	await page.waitForTimeout(16);
	states.push(await layer());
}
say("while it pans, the world is held as one layer", states.slice(1).every((one) => one === "transform"), states.join(" "));
const zooming = [];
for (let i = 0; i < 4; i++) {
	await page.keyboard.down("Control");
	await page.mouse.wheel(0, -20);
	await page.keyboard.up("Control");
	await page.waitForTimeout(16);
	zooming.push(await layer());
}
say("…and not while the zoom changes", zooming.every((one) => one === "auto"), zooming.join(" "));
await settle(page, 700);
say("…nor at rest", (await layer()) === "auto");

say("no errors on the page", errors.length === 0, errors.join(" | "));
await browser.close();
