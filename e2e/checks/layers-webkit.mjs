/**
 * In WebKit the camera puts nothing on layers of its own, while it zooms or while it pans.
 *
 * `LAYERS` in `packages/canvas/src/render/device.ts`: measured on an iPad and in WebKit on a Mac, a zoom
 * held 17 ms a frame with no layers, while building and dropping them cost a frame of 100 to 230 ms at
 * each end. So the stage never sets `data-scaling` or `data-sliding` in WebKit, and no card, document,
 * app or the world gets `will-change: transform`. Chromium keeps both, which `camera.mjs` checks.
 *
 * And while the scale moves every item's node is hidden and the sheet draws its picture (`moving` in
 * `rules.json`): Safari redrew each awake page at every step of a pinch, 22 to 35 dropped frames in a
 * low pinch on an iPad mini, and 0 to 8 with the nodes hidden.
 */
import { canvasFrame, onCanvasAt, open, say, settle } from "../harness.mjs";

const { browser, page, errors } = await open({ width: 1400, height: 900, engine: "webkit" });
const canvas = await canvasFrame(page);

/** What the stage says, and every element under the world that holds a `will-change: transform`. */
const layers = () =>
	canvas.evaluate(() => {
		const stage = document.querySelector(".stage");
		const promised = [...document.querySelectorAll(".world, .world *")].filter((el) => getComputedStyle(el).willChange.includes("transform"));
		const nodes = [...document.querySelectorAll(".card-node")];
		return { scaling: stage.dataset.scaling ?? null, sliding: stage.dataset.sliding ?? null, promised: promised.length, pictures: stage.dataset.cardPictures ?? null, nodes: nodes.length, shown: nodes.filter((n) => getComputedStyle(n).visibility !== "hidden").length };
	});

const spot = { x: 700, y: 420 };
if (await onCanvasAt(page, spot.x, spot.y)) await page.mouse.click(spot.x, spot.y);
await settle(page, 300);

await page.keyboard.press("Control+Equal");
const zooming = await layers();
say("a zoom in WebKit sets no layers", zooming.scaling !== "true" && zooming.promised === 0, JSON.stringify(zooming));
say("…and shows every item as its picture while it scales, no node of its own drawn", zooming.pictures === "true" && zooming.shown === 0, JSON.stringify(zooming));
await settle(page, 900);

await page.mouse.move(spot.x, spot.y);
await page.mouse.wheel(0, 120);
await settle(page, 60);
const panning = await layers();
say("…and a pan sets none either", panning.sliding !== "true" && panning.promised === 0, JSON.stringify(panning));
await settle(page, 600);

// `?engine=chromium` turns Chromium's layers on in this same browser: the switch is the table, not the browser.
await page.goto(page.url() + (page.url().includes("?") ? "&" : "?") + "engine=chromium");
const forced = await canvasFrame(page);
await settle(page, 1200);
await page.mouse.move(spot.x, spot.y);
await page.mouse.wheel(0, 120);
await settle(page, 60);
const sliding = await forced.evaluate(() => document.querySelector(".stage").dataset.sliding ?? null);
say("?engine=chromium gives the pan its layer back", sliding === "true", `data-sliding=${sliding}`);

say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
