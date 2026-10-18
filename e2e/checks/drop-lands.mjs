/**
 * A dragged item is put down after its drop. While held it is lifted: drawn by the page each frame,
 * left out of the worker's tiles, and the worker paints only the screen. Once the drawing that answers
 * the drop arrives it goes back into the tiles (`engine.ts`, `settle`), so the page stops drawing it
 * and the worker paints the margin and the overview again.
 */
import { editMode, open, resetStage, say, settle, socket } from "../harness.mjs";

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
say("no errors on the page", errors.length === 0, errors.join(" | "));
link.close?.();
await browser.close();
