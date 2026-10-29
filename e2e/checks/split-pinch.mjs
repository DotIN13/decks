/**
 * A pinch with one finger on a board's page and one on the bare canvas zooms by the fingers' spread.
 *
 * What this cannot show: Chromium sends every finger of a touch sequence to the frame the first one
 * landed in, so here both fingers reach the board's page and come up as messages. Safari on an iPad
 * gives the canvas's finger to the canvas, which then also held it from the browser's scroll only
 * when it saw two fingers of its own; that part is checked on a device. The board's finger reaches the stage only as a message
 * (`embed-guest.js`, `decks:touch`), so the browser saw one finger and scrolled the canvas with the
 * other while the pinch moved the camera too, and the two fought for every frame (`Stage.tsx`,
 * `forwarded`, `holdScroll`).
 */
import { deckState, open, resetStage, say, selectBoard, settle } from "../harness.mjs";

await resetStage();
const { browser, page, errors } = await open({ device: "iPad Pro 11", boards: false });
// A selected board shows its page at any zoom (`live-set.ts`): the widest one, so there is room beside it.
const deck = await deckState();
const widest = [...deck.boards].sort((x, y) => y.w - x.w)[0];
await selectBoard(page, widest.path);
await page.waitForFunction(() => [...document.querySelectorAll(".board-node:not([data-hidden-page]) iframe")].some((frame) => frame.contentWindow?.__boardReady === true), null, { timeout: 15000 }).catch(() => {});
await settle(page, 800);

// A point on a live board's page, and one on bare canvas level with it.
const spots = await page.evaluate(() => {
	const stage = document.querySelector(".stage");
	const frames = [...document.querySelectorAll(".board-node:not([data-hidden-page]) iframe")];
	for (const frame of frames) {
		const r = frame.getBoundingClientRect();
		for (const [fx, fy] of [[0.3, 0.4], [0.5, 0.5], [0.7, 0.3], [0.2, 0.7]]) {
			const a = { x: Math.round(r.left + r.width * fx), y: Math.round(r.top + r.height * fy) };
			if (a.x < 40 || a.y < 120 || a.x > innerWidth - 40 || a.y > innerHeight - 160 || document.elementFromPoint(a.x, a.y) !== frame) continue;
			for (const dx of [-260, 260, -200, 200, -320, 320]) {
				const b = { x: a.x + dx, y: a.y };
				if (b.x > 30 && b.x < innerWidth - 30 && document.elementFromPoint(b.x, b.y) === stage) return { a, b };
			}
		}
	}
	return null;
});
say("there is a live board's page and bare canvas beside it to pinch across", !!spots, JSON.stringify(spots ?? (await page.evaluate(() => ({ live: document.querySelector(".stage")?.dataset.live, view: [innerWidth, innerHeight], frames: [...document.querySelectorAll(".board-node iframe")].map((f) => { const r = f.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height), f.closest("[data-hidden-page]") ? "hidden" : "shown", document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.className?.toString().slice(0, 30)]; }) })))));

if (spots) {
	const camera = () => page.evaluate(() => {
		const m = /scale\(([\d.e-]+)\) translate\(([-\d.e]+)px, ([-\d.e]+)px\)/.exec(globalThis.__decksCameraTransform());
		return { zoom: Number(m[1]), x: -Number(m[2]), y: -Number(m[3]) };
	});
	const before = await camera();
	const cdp = await page.context().newCDPSession(page);
	const touchAt = (a, b) => [
		{ x: a.x, y: a.y, radiusX: 4, radiusY: 4, force: 1, id: 1 },
		{ x: b.x, y: b.y, radiusX: 4, radiusY: 4, force: 1, id: 2 },
	];
	const { a, b } = spots;
	const away = Math.sign(a.x - b.x);
	// The board's finger first, then the canvas's, as a hand lands.
	await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touchAt(a, b)[0]] });
	await page.waitForTimeout(120);
	await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: touchAt(a, b) });
	const steps = [];
	for (let i = 1; i <= 20; i++) {
		const spread = i * 6;
		await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: touchAt({ x: a.x + away * spread, y: a.y }, { x: b.x - away * spread, y: b.y }) });
		await page.waitForTimeout(16);
		steps.push(await camera());
	}
	await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
	await settle(page, 400);
	const want = (Math.abs(a.x - b.x) + 240) / Math.abs(a.x - b.x);
	const got = steps.at(-1).zoom / before.zoom;
	say("the zoom follows the fingers' spread", Math.abs(got / want - 1) < 0.15, `${got.toFixed(3)}× for a spread of ${want.toFixed(3)}×`);
	// Each step zooms in, never back: a scroll fighting the pinch made it lurch.
	const back = steps.filter((one, i) => i > 0 && one.zoom < steps[i - 1].zoom - 1e-6).length;
	say("…every step of it, with none going back", back === 0 && steps.at(-1).zoom > before.zoom, `${back} of ${steps.length} steps went back`);
	// The point midway between the fingers stays under them: the browser did not scroll the canvas away.
	const mid = (cam, p) => ({ x: cam.x + (p.x - innerWidthOf.w / 2) / cam.zoom, y: cam.y + (p.y - innerWidthOf.h / 2) / cam.zoom });
	var innerWidthOf = await page.evaluate(() => ({ w: document.querySelector(".stage").clientWidth, h: document.querySelector(".stage").clientHeight }));
	const centre = { x: (a.x + b.x) / 2, y: a.y };
	const was = mid(before, centre);
	const now = mid(steps.at(-1), centre);
	const drift = Math.hypot(now.x - was.x, now.y - was.y) * steps.at(-1).zoom;
	say("…and the point between the fingers stays under them", drift < 24, `${drift.toFixed(1)} px off`);
}
say("no errors on the page", errors.length === 0, errors.join(" | "));
await browser.close();
