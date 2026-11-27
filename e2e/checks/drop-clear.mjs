/**
 * A file dropped where something is already drawn lands beside it, not over it: the drop is aimed
 * where it was let go, then moved as one block to the clear spot nearest that (`files/drops.ts`,
 * `clearOf`, which asks `canvas.space` with `around`; the rule is `@decks/deck-kit`, `stepClear`).
 * The person asked for placement to be one rule: aim, then step clear.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { canvasFrame, deckState, open, resetStage, rest, say, settle, socket } from "../harness.mjs";

const until = async (test, ms = 10000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test();
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
};

const { browser, page, errors } = await open({ width: 1500, height: 1000 });
await resetStage(page);
await settle(page, 900);
const link = await socket();
const deck = await deckState();
const agentId = await until(() => link.last("agent.list")?.focused);
const stageName = await until(() => link.last("canvas.list")?.stages.find((row) => row.agents.some((agent) => agent.id === agentId))?.name);
const file = join(deck.path, "canvases", stageName ?? "?", "canvas.pen");
const items = () => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).children ?? [] : []);

const canvas = await canvasFrame(page);
// Onto bare canvas right of the fixture's cards (their right-hand edges at x 1600), as drop-lands does.
{
	const opening = await canvas.evaluate(() => globalThis.__decksProbes.rust.camera);
	await page.mouse.move(700, 450);
	await page.mouse.wheel((2900 - opening.x) * opening.zoom, 0);
	await rest(page).catch(() => {});
	await settle(page, 300);
}
// The middle of the stage, and the canvas point there (the engine's camera is the canvas point at the middle).
const point = await canvas.evaluate(() => {
	const r = document.querySelector(".canvas").getBoundingClientRect();
	const cam = globalThis.__decksProbes.rust.camera;
	const x = r.left + r.width / 2;
	const y = r.top + r.height / 2;
	if (globalThis.__decksProbes?.cardAt?.(x, y)) return null;
	return { x, y, world: { x: cam.x, y: cam.y } };
});
if (!point) {
	say("a point clear of cards to drop on", false);
} else {
	// Something drawn right where the file will be let go: 600 by 400, centred on the drop.
	const blocker = { x1: Math.round(point.world.x - 300), y1: Math.round(point.world.y - 200), x2: Math.round(point.world.x + 300), y2: Math.round(point.world.y + 200) };
	link.edit(agentId, [{ op: "insert", node: { type: "rectangle", id: "drop-blocker", fill: "#4c8bf5" }, box: blocker }]);
	say("the box is drawn under the drop point", !!(await until(() => items().find((node) => node.id === "drop-blocker"))));
	await settle(page, 600);
	await canvas.evaluate(({ x, y }) => {
		const data = new DataTransfer();
		data.items.add(new File(["%PDF-1.4 a paper"], "e2e-clear.pdf", { type: "application/pdf" }));
		const target = document.elementFromPoint(x, y) ?? document.body;
		for (const type of ["dragenter", "dragover", "drop"]) target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: data }));
	}, point);
	const card = await until(() => items().find((node) => node.metadata?.type === "decks.file" && /e2e-clear\.pdf$/.test(String(node.metadata.path))), 15000);
	say("the PDF is put on the canvas as a file card", !!card, JSON.stringify(items().map((n) => n.metadata?.type ?? n.type)));
	if (card) {
		const box = { x1: card.x, y1: card.y, x2: card.x + Number(card.width ?? 0), y2: card.y + Number(card.height ?? 52) };
		const covers = box.x1 < blocker.x2 && blocker.x1 < box.x2 && box.y1 < blocker.y2 && blocker.y1 < box.y2;
		say("…beside the box, not over it", !covers, JSON.stringify({ box, blocker }));
		// The nearest clear spot: within the drop margin (40) and the card's own size of the box's edge.
		const gap = Math.max(blocker.x1 - box.x2, box.x1 - blocker.x2, blocker.y1 - box.y2, box.y1 - blocker.y2);
		say("…and close to it, where it was dropped", gap >= 0 && gap <= 60, `gap ${gap}`);
	}
}
say("no errors on the page", errors.length === 0, errors.join(" | "));
link.close?.();
await browser.close();
