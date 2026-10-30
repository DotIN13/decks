/**
 * Arrows bend with a drag, routed by the stage engine itself at every step.
 *
 * Two boxes joined by an arrow; one is dragged (the engine's own preview, as a drag sends it). The
 * arrow is routed again in the page's engine from where the box is at each step (`arrows.rs`, pen's
 * router ported) and lifted with the box, so the worker paints its tiles once without them and then
 * not again however long the drag. Letting go leaves the arrow to the saved drawing. A board dragged
 * alone bends the arrows ending on it the same way.
 */
import { canvasFrame, open, resetStage, say, settle, socket, rest } from "../harness.mjs";

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
await rest(page, { start: 0 });
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
const canvas = await canvasFrame(page);
const engine = await canvas.evaluateHandle(() => globalThis.__decksRust);
const placed = (id) => canvas.evaluate((id) => globalThis.__decksRust?.placed.get(id)?.box, id);
const routed = await until(() => placed("bend-ab"));
say("the engine has the joined arrow, routed by the server", !!routed, JSON.stringify(routed));

// Look at the two boxes, and count the tiles the worker paints from here on.
await canvas.evaluate(() => {
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

const step = (dy) => canvas.evaluate((dy) => new Promise((done) => {
	globalThis.__decksRust.preview(new Map([["bend-a", { dx: 0, dy }]]));
	requestAnimationFrame(() => done());
}), dy);

await step(10);
await settle(page, 600);
const lifted = await canvas.evaluate(() => [...globalThis.__decksRust.lifted]);
say("the first step lifts the box and the arrow joined to it", lifted.includes("bend-a") && lifted.includes("bend-ab"), JSON.stringify(lifted));

await canvas.evaluate(() => (globalThis.__tilesPainted = 0));
const boxes = [];
const started = Date.now();
for (let dy = 20; dy <= 300; dy += 10) {
	await step(dy);
	boxes.push(await placed("bend-ab"));
}
const ms = (Date.now() - started) / 29;
await settle(page, 600);
const painted = await canvas.evaluate(() => globalThis.__tilesPainted);
say("29 more steps paint no tile at all", painted === 0, `${painted} tiles`);
const grew = boxes.every((box, i) => i === 0 || box.h >= boxes[i - 1].h) && boxes.at(-1).h > boxes[0].h + 250;
say("the arrow follows the box at every step: its elbow grows as the box goes down", grew, JSON.stringify([boxes[0], boxes.at(-1)]));
say("a step takes under a frame", ms < 16, `${ms.toFixed(1)} ms a step, with a frame between`);

// Let go without saving: the drawing's own arrow comes back.
await canvas.evaluate(() => globalThis.__decksRust.preview(undefined));
await settle(page, 400);
const back = await placed("bend-ab");
say("letting go puts the saved arrow back", back && Math.abs(back.h - routed.h) < 0.5, JSON.stringify(back));

// --- a board dragged alone: an arrow ending on it bends with it -------------------------------------
const board = await canvas.evaluate(() => window.__decksBoards()[0]);
link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "insert", node: { type: "path", id: "bend-board", geometry: "M0 0 L1 1", metadata: { type: "decks.arrow", from: "bend-b", to: board.path, route: "elbow" } } }] });
const saved = await until(() => placed("bend-board"));
say("an arrow from a box to a board is routed by the server", !!saved, JSON.stringify(saved));
const carry = (path, dy) => canvas.evaluate(([path, dy]) => new Promise((done) => {
	globalThis.__decksRust.carry(path ? [path] : [], { dx: 0, dy });
	requestAnimationFrame(() => done());
}), [board.path, dy].map((v, i) => (i === 0 ? (dy === null ? "" : v) : (v ?? 0))));
// The first step lifts the arrow, which paints the tiles under it once without it.
await carry(board.path, 20);
await settle(page, 600);
await canvas.evaluate(() => (globalThis.__tilesPainted = 0));
const carried = [];
for (let dy = 40; dy <= 400; dy += 40) {
	await carry(board.path, dy);
	carried.push(await placed("bend-board"));
}
const liftedNow = await canvas.evaluate(() => globalThis.__decksRust.lifted.has("bend-board"));
say("dragging the board alone lifts the arrow and routes it at every step", liftedNow && carried.every((box, i) => i === 0 || JSON.stringify(box) !== JSON.stringify(carried[i - 1])), JSON.stringify([saved, carried.at(-1)]));
await settle(page, 600);
const boardPainted = await canvas.evaluate(() => globalThis.__tilesPainted);
say("…and the steps after the lift paint no tile", boardPainted === 0, `${boardPainted} tiles`);
await carry(null, null);
const kept = await placed("bend-board");
say("let go, the arrow stays where it was routed until the drawing comes back", JSON.stringify(kept) === JSON.stringify(carried.at(-1)), JSON.stringify(kept));
await settle(page, 2400);
const after = await placed("bend-board");
say("with no drawing back in two seconds, it returns to the saved arrow", JSON.stringify(after) === JSON.stringify(saved), JSON.stringify(after));

say("no errors on the page", errors.length === 0, errors.join(" | "));
await engine.dispose();
link.close?.();
await browser.close();
