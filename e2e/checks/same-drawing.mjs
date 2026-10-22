/**
 * An agent's edits and a person's end in the same drawing as opening the canvas afresh.
 *
 * The stage takes in a change as the edits that made it (`stage.pen.delta`, applied to the app's
 * copy sharing what they did not reach, `editDocument`) and its engine re-lays and reads back only
 * the top-level items they reached (`layoutChanges`, `stage/engine.ts` `laidOut`). This puts it
 * through every kind of change, from an agent over the wire and from a person's drag, and then asks
 * three things: the page's copy of the drawing is the server's; the layout the stage holds, made up
 * change by change, is the one its engine gives whole; and it is the one a fresh page lays out.
 */
import { editMode, open, resetStage, rest, say, settle, socket } from "../harness.mjs";

const until = async (test, ms = 8000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test();
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
};
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, canon(x)])) : v);

await resetStage();
const { browser, page, errors } = await open({ width: 1400, height: 900 });
await rest(page, { start: 0 });
const link = await socket();
const agentId = await until(() => link.last("agents")?.focused);
const cam = await page.evaluate(() => globalThis.__decksRust.camera);
const z = cam.zoom;
const at = (dx, dy, w, h) => ({ x1: cam.x + dx / z, y1: cam.y + dy / z, x2: cam.x + (dx + w) / z, y2: cam.y + (dy + h) / z });
/** The layout as the stage holds it, made up change by change, and as its engine gives it whole. */
const layouts = () =>
	page.evaluate(() => {
		const engine = globalThis.__decksRust;
		const r = (n) => Math.round(n * 100) / 100;
		const held = [...engine.placed.values()].map((p) => [p.node.id, r(p.box.x), r(p.box.y), r(p.box.w), r(p.box.h), p.parent ?? null, p.order]);
		const whole = JSON.parse(engine.page.layout()).map(([id, x, y, w, h, parent, order]) => [id, r(x), r(y), r(w), r(h), parent, order]);
		const bounds = [...engine.bounds].map(([id, b]) => [id, r(b.x), r(b.y), r(b.w), r(b.h)]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
		const cards = engine.cards().map((c) => [c.id, c.order, r(c.box.x), r(c.box.y), r(c.box.w), r(c.box.h), c.links.length]);
		const wholeCards = JSON.parse(engine.page.cards()).map((c) => [c.id, c.order, r(c.box.x), r(c.box.y), r(c.box.w), r(c.box.h), c.links.length]);
		return { held, whole, bounds, cards, wholeCards, doc: engine.doc };
	});
const first = (a, b) => {
	for (let i = 0; i < Math.max(a.length, b.length); i++) if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return `${i}: ${JSON.stringify(a[i])} vs ${JSON.stringify(b[i])}`;
	return "";
};
/** Where the layout held and the engine's whole one first differed, after each change. */
const disagreed = [];
const agree = async (after) => {
	const now = await layouts();
	const where = first(now.held, now.whole) || first(now.cards, now.wholeCards);
	if (where) disagreed.push(`${after}: ${where}`);
};
let edits = 0;
const edit = async (ops, ready, arg) => {
	link.send({ type: "stage.pen.edit", agentId, ops });
	const done = await until(() => page.evaluate(ready, arg));
	await agree(`edit ${++edits}`);
	return done;
};

// --- an agent's edits: inserts at the top and inside a column, an arrow, words, a move, a delete ----------
say(
	"an agent's items are drawn",
	!!(await edit(
		[
			{ op: "insert", node: { type: "rectangle", id: "sd-a", fill: "#4c8bf5" }, box: at(-300, -60, 120, 80) },
			{ op: "insert", node: { type: "ellipse", id: "sd-b", fill: "#f5a623" }, box: at(120, 100, 100, 70) },
			{
				op: "insert",
				node: { type: "frame", id: "sd-col", name: "Column", layout: "vertical", gap: 10, padding: 12, fill: "#eeeeee", children: [{ type: "note", id: "sd-n1", metadata: { type: "decks.markdown" }, content: "One", width: 160 }, { type: "note", id: "sd-n2", metadata: { type: "decks.markdown" }, content: "Two", width: 160 }] },
				box: at(260, -300, 184, 200),
			},
			{ op: "insert", node: { type: "note", id: "sd-gone", metadata: { type: "decks.markdown" }, content: "Going", width: 140 }, box: at(-300, 160, 140, 60) },
			// Never edited: it only moves down the paint order as items come before it.
			{ op: "insert", node: { type: "text", id: "sd-z", content: "Last in paint order", fontSize: 18, fill: "#374151" }, box: at(-80, 220, 200, 30) },
		],
		() => ["sd-a", "sd-b", "sd-n2", "sd-gone"].every((id) => globalThis.__decksRust.placed.has(id)),
	)),
);
const arrow = { type: "path", id: "sd-arrow", stroke: "#6b7280", strokeWidth: 3, geometry: "M2 2 L100 50", width: 102, height: 52, viewBox: [0, 0, 102, 52], metadata: { type: "decks.arrow", from: { item: "sd-a" }, to: { item: "sd-b" }, route: "curved" } };
say("…an arrow joins two of them", !!(await edit([{ op: "insert", node: arrow, box: at(-100, 0, 102, 52) }], () => globalThis.__decksRust.placed.has("sd-arrow"))));
const tallBefore = await page.evaluate(() => globalThis.__decksRust.placed.get("sd-n2").box.y);
say(
	"…longer words in a column's first note move the one under it",
	!!(await edit([{ op: "update", id: "sd-n1", set: { content: "One, now with a great many more words in it, so that it wraps onto several lines in the column" } }], (y) => globalThis.__decksRust.placed.get("sd-n2").box.y > y + 10, tallBefore)),
);
say("…a child added to the column", !!(await edit([{ op: "insert", parent: "sd-col", node: { type: "note", id: "sd-n3", metadata: { type: "decks.markdown" }, content: "Three", width: 160 } }], () => globalThis.__decksRust.placed.get("sd-n3")?.parent === "sd-col")));
say("…one deleted", !!(await edit([{ op: "delete", id: "sd-gone" }], () => !globalThis.__decksRust.placed.has("sd-gone"))));
const bx = await page.evaluate(() => globalThis.__decksRust.placed.get("sd-b").box.x);
say("…one moved, and its arrow follows", !!(await edit([{ op: "update", id: "sd-b", set: { x: Math.round(bx + 80) } }], (x) => globalThis.__decksRust.placed.get("sd-b").box.x > x + 40, bx)));

// --- a person's drag of the joined box: its arrow bends during the drag and lands with it -------------
await settle(page, 600);
await editMode(page, true);
await page.keyboard.press("Escape");
const a = await page.evaluate(() => globalThis.__decksPenBox("sd-a").toJSON());
const ax = a.x + a.width / 2;
const ay = a.y + a.height / 2;
const before = await page.evaluate(() => globalThis.__decksRust.placed.get("sd-a").box);
await page.mouse.move(ax, ay);
await page.mouse.down();
for (let i = 1; i <= 12; i++) {
	await page.mouse.move(ax + i * 8, ay - i * 6);
	await page.waitForTimeout(25);
}
const lifted = await page.evaluate(() => [...globalThis.__decksRust.lifted]);
await agree("a drag's step");
say("a person's drag lifts the box and bends its arrow", lifted.includes("sd-a") && lifted.includes("sd-arrow"), JSON.stringify(lifted));
await page.mouse.up();
say("…and is put down", await until(async () => (await page.evaluate(() => globalThis.__decksRust.lifted.size)) === 0, 5000));
const after = await page.evaluate(() => globalThis.__decksRust.placed.get("sd-a").box);
say("…where it was dropped", after.x > before.x && after.y < before.y, JSON.stringify({ before, after }));
await settle(page, 1200);

// --- the three agreements -------------------------------------------------------------------------------
const live = await layouts();
say("after each change, the layout held is the engine's whole one", disagreed.length === 0, disagreed.slice(0, 2).join(" | "));
say("the stage's layout, made change by change, is its engine's whole one, in paint order", JSON.stringify(live.held) === JSON.stringify(live.whole), first(live.held, live.whole) || `${live.held.length} items`);
say("…and so are the cards", JSON.stringify(live.cards) === JSON.stringify(live.wholeCards), first(live.cards, live.wholeCards) || `${live.cards.length} cards`);
link.send({ type: "stage.pen.get", agentId });
const server = await until(() => link.received.filter((m) => m.type === "stage.pen" && m.agentId === agentId).at(-1));
const serverDoc = server?.doc;
say("the page's drawing is the server's", !!serverDoc && JSON.stringify(canon(live.doc)) === JSON.stringify(canon(serverDoc)));

await page.reload({ waitUntil: "load" });
await until(() => page.evaluate(() => globalThis.__decksRust?.placed?.has("sd-arrow")), 15000);
await settle(page, 1200);
const fresh = await layouts();
say("a fresh page lays the drawing out the same", JSON.stringify(fresh.held) === JSON.stringify(live.held), first(fresh.held, live.held) || `${fresh.held.length} items`);
say("…with the same covers", JSON.stringify(fresh.bounds) === JSON.stringify(live.bounds), first(fresh.bounds, live.bounds));
say("…and the same cards", JSON.stringify(fresh.cards) === JSON.stringify(live.cards), first(fresh.cards, live.cards));
say("no errors on the page", errors.length === 0, errors.slice(0, 3).join(" | "));
link.close();
await browser.close();
