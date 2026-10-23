/**
 * A canvas is framed on everything on it, not only its boards.
 *
 * A canvas can be all drawing: notes, shapes, arrows and ink with no board. Landing on one (a switch
 * of canvas) and Fit (the corner button, or 0) both used to take the boards' boxes alone, so a canvas
 * of drawing landed on nothing and Fit did nothing. Here a canvas holds only three notes, far from
 * the origin; switching to it must show them, and so must Fit after the view is moved away.
 */
import { open, rest, resetStage, say, settle, socket } from "../harness.mjs";

const until = async (test, ms = 10000) => {
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
const focused = await until(() => link.last("agents")?.focused);
say("the server says which agent is focused", !!focused);

// A second chat in a workspace of its own, so it gets its own canvas, holding three notes and nothing else.
const before = new Set((link.last("agents")?.chats ?? []).map((chat) => chat.id));
link.send({ type: "agent.create", workspace: "canvas-frame-check" });
const other = await until(() => (link.last("agents")?.chats ?? []).map((chat) => chat.id).find((id) => !before.has(id)), 15000);
say("a second chat to draw with", !!other);
const notes = [[6000, 4000], [6400, 4100], [6200, 4400]].map(([x, y], index) => ({ op: "insert", node: { type: "note", id: `far-${index}`, content: "Far away" }, box: { x1: x, y1: y, x2: x + 240, y2: y + 120 } }));
link.send({ type: "stage.pen.edit", agentId: other, ops: notes });
const canvas = await until(() => (link.received.filter((m) => m.type === "stages").at(-1)?.stages ?? []).find((one) => one.agents.some((agent) => agent.id === other))?.name, 12000);
say("the second chat has a canvas of drawing only", !!canvas, String(canvas));

// What the camera shows: are the notes' middle and the window's middle close, at a zoom where notes read?
const middleShown = () => page.evaluate(() => {
	const world = document.querySelector("[style*=scale]");
	const m = world?.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([\d.]+)\) translate\(([-\d.]+)px, ([-\d.]+)px\)/);
	if (!m) return null;
	const [, , , zoom, tx, ty] = m.map(Number);
	return { x: -tx, y: -ty, zoom };
});
const near = (camera) => !!camera && camera.x > 5800 && camera.x < 6900 && camera.y > 3800 && camera.y < 4800;

// Switch the conversation on screen to that canvas: the camera must land on the notes.
link.send({ type: "agent.stage", id: focused, stage: canvas });
const landed = await until(async () => { const c = await middleShown(); return near(c) ? c : undefined; }, 8000);
say("switching to a canvas of drawing lands on its drawing", !!landed, JSON.stringify(await middleShown()));

// Move far away, then Fit: the notes come back into view.
await page.mouse.move(700, 450);
for (let i = 0; i < 20; i++) await page.mouse.wheel(4000, 4000);
await settle(page, 600);
say("…the view was moved away from them", !near(await middleShown()), JSON.stringify(await middleShown()));
await page.locator("[aria-label='Fit everything on the canvas']").click();
const fitted = await until(async () => { const c = await middleShown(); return near(c) ? c : undefined; }, 4000);
say("Fit frames the drawing too", !!fitted, JSON.stringify(await middleShown()));

link.close();
say("no console errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
