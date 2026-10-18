/**
 * Arrows bend with a drag, routed by the stage engine itself at every step.
 *
 * Two boxes joined by an arrow; one is dragged (the engine's own preview, as a drag sends it). The
 * arrow is routed again in the page's engine from where the box is at each step (`arrows.rs`, pen's
 * router ported) and lifted with the box, so the worker paints its tiles once without them and then
 * not again however long the drag. Letting go leaves the arrow to the saved drawing.
 */
import { open, resetStage, say, settle, socket } from "../harness.mjs";

const until = async (test, ms = 8000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test();
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
};

await resetStage();
const { browser, page, errors } = await open({ width: 1400, height: 900 });
await settle(page, 1500);
const link = await socket();
const agentId = await until(() => link.last("agents")?.focused);

link.send({
	type: "stage.pen.edit",
	agentId,
	ops: [
		{ op: "insert", node: { type: "rectangle", id: "bend-a", fill: "#4c8bf5" }, box: { x1: 9000, y1: 9000, x2: 9120, y2: 9070 } },
		{ op: "insert", node: { type: "rectangle", id: "bend-b", fill: "#f5a34c" }, box: { x1: 9400, y1: 9000, x2: 9520, y2: 9070 } },
		{ op: "insert", node: { type: "path", id: "bend-ab", geometry: "M0 0 L1 1", metadata: { type: "decks.arrow", from: "bend-a", to: "bend-b", route: "elbow" } } },
	],
});
const engine = await page.evaluateHandle(() => globalThis.__decksRust);
const placed = (id) => page.evaluate((id) => globalThis.__decksRust?.placed.get(id)?.box, id);
const routed = await until(() => placed("bend-ab"));
say("the engine has the joined arrow, routed by the server", !!routed, JSON.stringify(routed));

// Look at the two boxes, and count the tiles the worker paints from here on.
await page.evaluate(() => {
	const stage = globalThis.__decksRust;
	stage.setCamera({ x: 8900, y: 8800, zoom: 1 });
	const worker = stage.worker;
	const before = worker.onmessage;
	globalThis.__tilesPainted = 0;
	worker.onmessage = (event) => {
		if (event.data?.type === "tiles") globalThis.__tilesPainted += event.data.tiles.length;
		before.call(worker, event);
	};
});
await settle(page, 800);

const step = (dy) => page.evaluate((dy) => new Promise((done) => {
	globalThis.__decksRust.preview(new Map([["bend-a", { dx: 0, dy }]]));
	requestAnimationFrame(() => done());
}), dy);

await step(10);
await settle(page, 600);
const lifted = await page.evaluate(() => [...globalThis.__decksRust.lifted]);
say("the first step lifts the box and the arrow joined to it", lifted.includes("bend-a") && lifted.includes("bend-ab"), JSON.stringify(lifted));

await page.evaluate(() => (globalThis.__tilesPainted = 0));
const boxes = [];
const started = Date.now();
for (let dy = 20; dy <= 300; dy += 10) {
	await step(dy);
	boxes.push(await placed("bend-ab"));
}
const ms = (Date.now() - started) / 29;
await settle(page, 600);
const painted = await page.evaluate(() => globalThis.__tilesPainted);
say("29 more steps paint no tile at all", painted === 0, `${painted} tiles`);
const grew = boxes.every((box, i) => i === 0 || box.h >= boxes[i - 1].h) && boxes.at(-1).h > boxes[0].h + 250;
say("the arrow follows the box at every step: its elbow grows as the box goes down", grew, JSON.stringify([boxes[0], boxes.at(-1)]));
say("a step takes under a frame", ms < 16, `${ms.toFixed(1)} ms a step, with a frame between`);

// Let go without saving: the drawing's own arrow comes back.
await page.evaluate(() => globalThis.__decksRust.preview(undefined));
await settle(page, 400);
const back = await placed("bend-ab");
say("letting go puts the saved arrow back", back && Math.abs(back.h - routed.h) < 0.5, JSON.stringify(back));

say("no errors on the page", errors.length === 0, errors.join(" | "));
await engine.dispose();
link.close?.();
await browser.close();
