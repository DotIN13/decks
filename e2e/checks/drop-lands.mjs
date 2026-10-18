/**
 * A dragged item is put down after its drop. While held it is lifted: drawn by the page each frame,
 * left out of the worker's tiles, and the worker paints only the screen. Once the drawing that answers
 * the drop arrives it goes back into the tiles (`engine.ts`, `settle`), so the page stops drawing it
 * and the worker paints the margin and the overview again.
 *
 * Dropped into a slot of a frame that arranges its children, it glides from where it was let go to
 * where it lands, and the siblings that make room glide too (`editor/core/glide.ts`). Its outline
 * glides with it, frame by frame, rather than jumping ahead to where it lands.
 */
import { editMode, open, resetStage, say, settle, socket, rest } from "../harness.mjs";

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
const cam = await page.evaluate(() => globalThis.__decksRust.camera);
const r = await page.evaluate(() => document.querySelector(".stage").getBoundingClientRect().toJSON());
// The engine's camera is the stage point at the middle of the window: a box there.
link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "insert", node: { type: "rectangle", id: "lift-a", fill: "#4c8bf5" }, box: { x1: cam.x - 60 / cam.zoom, y1: cam.y - 40 / cam.zoom, x2: cam.x + 60 / cam.zoom, y2: cam.y + 40 / cam.zoom } }] });
say("the box is drawn", !!(await until(() => page.evaluate(() => globalThis.__decksRust?.placed.get("lift-a")))));
await editMode(page, true);
const x = r.left + r.width / 2;
const y = r.top + r.height / 2;
await page.mouse.move(x, y);
await page.mouse.down();
for (let i = 1; i <= 10; i++) {
	await page.mouse.move(x + i * 10, y + i * 5);
	await page.waitForTimeout(30);
}
const during = await page.evaluate(() => [...globalThis.__decksRust.lifted]);
say("dragged, the box is lifted", during.includes("lift-a"), JSON.stringify(during));
const before = await page.evaluate(() => globalThis.__decksRust.placed.get("lift-a").box);
await page.mouse.up();
const down = await until(async () => (await page.evaluate(() => globalThis.__decksRust.lifted.size)) === 0, 4000);
say("dropped, it is put down once the saved drawing has come", down);
const moved = await page.evaluate(() => globalThis.__decksRust.placed.get("lift-a").box);
say("…where it was dropped", moved.x > before.x && moved.y > before.y, JSON.stringify({ before, moved }));

// Into a column's slot: the outline rides the glide.
{
	const z = cam.zoom;
	const rect = (id, fill) => ({ type: "rectangle", id, fill, width: 160, height: 50 });
	link.send({
		type: "stage.pen.edit",
		agentId,
		ops: [
			{ op: "insert", node: { type: "frame", id: "lift-col", name: "Column", layout: "vertical", gap: 10, padding: 12, fill: "#eeeeee", children: [rect("lift-r1", "#88aaff"), rect("lift-r2", "#88ffaa"), rect("lift-r3", "#ffcc88")] }, box: { x1: cam.x + 260 / z, y1: cam.y - 260 / z, x2: cam.x + 444 / z, y2: cam.y - 60 / z } },
			{ op: "insert", node: { type: "rectangle", id: "lift-b", fill: "#ff3355" }, box: { x1: cam.x - 420 / z, y1: cam.y + 120 / z, x2: cam.x - 320 / z, y2: cam.y + 180 / z } },
		],
	});
	const box = (id) => page.evaluate((id) => globalThis.__decksPenBox?.(id)?.toJSON(), id);
	await until(async () => (await box("lift-r3")) && (await box("lift-b")));
	await settle(page, 600);
	await page.keyboard.press("Escape");
	const b = await box("lift-b");
	const r1 = await box("lift-r1");
	const r2 = await box("lift-r2");
	await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
	await settle(page, 300);
	// Every frame from here: the selection's outline, and where the engine last said the item glides from.
	await page.evaluate(() => {
		const engine = globalThis.__decksRust;
		const own = engine.onGlide;
		engine.onGlide = (shifts) => {
			globalThis.__lastGlide = shifts;
			own?.(shifts);
		};
		globalThis.__frames = [];
		globalThis.__sampling = true;
		const sample = () => {
			const outline = document.querySelector(".pen-selection")?.getBoundingClientRect();
			const drawn = globalThis.__decksPenBox?.("lift-b");
			const shift = globalThis.__lastGlide?.get("lift-b");
			if (shift && outline && drawn) {
				const zoom = engine.camera.zoom;
				globalThis.__frames.push({ outline: [outline.x, outline.y], item: [drawn.x + shift.dx * zoom, drawn.y + shift.dy * zoom], shift: [shift.dx, shift.dy] });
			}
			if (globalThis.__sampling) requestAnimationFrame(sample);
		};
		requestAnimationFrame(sample);
	});
	const sx = b.x + b.width / 2;
	const sy = b.y + b.height / 2;
	await page.mouse.move(sx, sy);
	await page.mouse.down();
	await page.mouse.move(sx + 20, sy - 20, { steps: 3 });
	await page.mouse.move(r1.x + 60, (r1.y + r1.height + r2.y) / 2, { steps: 20 });
	await settle(page, 200);
	await page.mouse.up();
	const joined = await until(async () => (await page.evaluate(() => globalThis.__decksRust.placed.get("lift-b")?.parent)) === "lift-col", 4000);
	await settle(page, 400);
	const frames = await page.evaluate(() => {
		globalThis.__sampling = false;
		return globalThis.__frames;
	});
	say("dropped into the column's slot, the item joins it", joined);
	const moving = frames.filter((f) => Math.abs(f.shift[0]) > 0.5 || Math.abs(f.shift[1]) > 0.5);
	say("…and glides there over several frames", moving.length >= 3, `${moving.length} gliding frames`);
	const off = frames.filter((f) => Math.abs(f.outline[0] - f.item[0]) > 1 || Math.abs(f.outline[1] - f.item[1]) > 1);
	say("…its outline riding with it on every frame of the glide", frames.length > 0 && off.length === 0, JSON.stringify(off.slice(0, 3)));
	link.send({ type: "stage.pen.edit", agentId, ops: ["lift-col", "lift-b"].map((id) => ({ op: "delete", id })) });
	await settle(page, 300);
}

say("no errors on the page", errors.length === 0, errors.join(" | "));
link.close?.();
await browser.close();
