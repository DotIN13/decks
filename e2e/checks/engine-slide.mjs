/**
 * A pan frame is one cheap draw of the window.
 *
 * The engine's canvas is the window's size and is placed over it wherever the world has moved
 * (`stage/engine.ts`, `place`), as the old engine's was. Each camera draws it again: the tiles and the
 * boards' pictures as textured quads, a fraction of a millisecond of the page's time. This check once
 * held that a pan slid a canvas a margin bigger than the window instead of drawing it; that margin
 * made the worker paint it too, and is gone, so what it holds now is that each pan step is one draw,
 * a cheap one, and that the canvas covers the window at every step.
 */
import { open, resetStage, say, settle } from "../harness.mjs";

await resetStage();
const { browser, page, errors } = await open({ width: 1400, height: 900, dpr: 2 });
await settle(page, 1500);
await page.waitForFunction(() => window.__decksRust?.page && window.__decksSheet, null, { timeout: 15000 });

const draws = () => page.evaluate(() => window.__decksSheet.shown ?? 0);
/** Whether the canvas covers the whole window, as it must at every frame. */
const covers = () =>
	page.evaluate(() => {
		const r = document.querySelector("canvas.stage-engine-over").getBoundingClientRect();
		return Math.abs(r.left) <= 0.5 && Math.abs(r.top) <= 0.5 && Math.abs(r.right - innerWidth) <= 0.5 && Math.abs(r.bottom - innerHeight) <= 0.5;
	});

const size = await page.evaluate(() => {
	const c = document.querySelector("canvas.stage-engine-over");
	return { w: c.width, h: c.height, css: c.getBoundingClientRect().width };
});
say("the canvas is the window, no margin", Math.abs(size.css - 1400) < 1 && size.w === 2800 && size.h === 1800, JSON.stringify(size));

// The page's time in each draw, from here on.
await page.evaluate(() => {
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
say("twenty small pan steps draw the canvas about once a step", during >= 15 && during <= 40, `${during} draws`);
say("the canvas covers the window at every step", gaps === 0, `${gaps} steps with a gap`);

for (let i = 0; i < 30; i++) {
	await page.mouse.wheel(60, 0);
	await page.waitForTimeout(16);
	if (!(await covers())) gaps++;
}
say("a long pan still covers the window at every step", gaps === 0, `${gaps} steps with a gap`);
const ms = await page.evaluate(() => [...window.__slideMs].sort((a, b) => a - b));
const median = ms[Math.floor(ms.length / 2)] ?? Infinity;
say("a pan frame is one cheap draw: the page's median draw under 2 ms", median < 2, `${median.toFixed(2)} ms over ${ms.length} draws`);

const moved = await draws();
await settle(page, 600);
say("at rest it is drawn once more, over the window", (await draws()) > moved && (await covers()));

// The world is one layer while it slides at one zoom, and never across a change of scale or at rest.
const layer = () => page.evaluate(() => getComputedStyle(document.querySelector(".world")).willChange);
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
