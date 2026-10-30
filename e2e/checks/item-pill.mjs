/**
 * The pill over a selected item leaves its arrow handle free.
 *
 * A selected drawn item shows four places an arrow can leave from, 14 px out from each side; the
 * pill over it used to sit 10 px above the item, on top of the top one, so a press there opened no
 * arrow. While those handles show, the pill sits clear of them with 6 px between.
 */
import { API, asPerson, canvasFrame, editMode, onCanvasAt, open, resetStage, say, settle, socket, rest } from "../harness.mjs";

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
await editMode(page, true);
/** The canvas frame: the stage, its pill and its handles are there. */
const canvas = await canvasFrame(page);

// An empty place in the middle of the screen, in stage units, with room above it for the pill.
const spot = await canvas.evaluate(() => {
	const m = new DOMMatrix(globalThis.__decksCameraTransform());
	return { x: (560 - m.e) / m.a, y: (420 - m.f) / m.a, zoom: m.a };
});
const w = 200 / spot.zoom;
const h = 120 / spot.zoom;
link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "insert", node: { type: "rectangle", id: "pill-box", fill: "#4c8bf5" }, box: { x1: spot.x, y1: spot.y, x2: spot.x + w, y2: spot.y + h } }] });
const box = await until(() => canvas.evaluate(() => window.__decksPenBox?.("pill-box")));
say("the box is on screen", !!box, JSON.stringify(box));

await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await until(() => canvas.locator(".stage-fixed > .board-callout:not([data-hidden])").count());
// The pill fades in from 4 px lower: measure it at rest.
await settle(page, 300);
const anchor = await until(() => canvas.locator('.pen-anchor[data-side="top"]').boundingBox());
const pill = await until(() => canvas.locator(".stage-fixed > .board-callout:not([data-hidden])").boundingBox());
say("a selected box shows its top arrow handle and the pill", !!anchor && !!pill, JSON.stringify({ anchor, pill }));
const clear = anchor && pill ? anchor.y - (pill.y + pill.height) : NaN;
say("the pill sits above the handle, 6 px clear of it", Math.abs(clear - 6) < 1.5, `${clear.toFixed?.(1)} px`);
const free = await canvas.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.classList.contains("pen-anchor"), { x: anchor.x + anchor.width / 2, y: anchor.y + anchor.height / 2 });
say("nothing covers the handle's middle", free === true);

// A drag from it draws an arrow from the top side.
await page.mouse.move(anchor.x + anchor.width / 2, anchor.y + anchor.height / 2);
await page.mouse.down();
await page.mouse.move(anchor.x + 200, anchor.y - 40, { steps: 6 });
await page.mouse.move(anchor.x + 260, anchor.y - 60, { steps: 6 });
await page.mouse.up();
const arrow = await until(() => link.received.filter((m) => m.type === "stage.pen" && m.agentId === agentId).at(-1)?.doc.children.find((n) => n.metadata?.type === "decks.arrow" && (n.metadata.from === "pill-box" || n.metadata.from?.item === "pill-box")));
say("a drag from the handle draws an arrow from the top", arrow?.metadata.from?.side === "top", JSON.stringify(arrow?.metadata));

// Two items selected have no handles, and their pill keeps its own 10 px.
link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "insert", node: { type: "rectangle", id: "pill-two", fill: "#f5a34c" }, box: { x1: spot.x + w + 40 / spot.zoom, y1: spot.y, x2: spot.x + 2 * w + 40 / spot.zoom, y2: spot.y + h } }] });
const two = await until(() => canvas.evaluate(() => window.__decksPenBox?.("pill-two")));
await page.keyboard.press("Escape");
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.keyboard.down("Shift");
await page.mouse.click(two.x + two.width / 2, two.y + two.height / 2);
await page.keyboard.up("Shift");
await settle(page, 400);
const both = await canvas.evaluate(() => ({ anchors: document.querySelectorAll(".pen-anchor").length, pill: document.querySelector(".stage-fixed > .board-callout:not([data-hidden])")?.getBoundingClientRect().bottom }));
const top = Math.min(box.y, two.y);
say("two selected have no handles, and the pill sits 10 px above them", both.anchors === 0 && Math.abs(top - both.pill - 10) < 1.5, JSON.stringify({ ...both, top }));

// A group with a board in it: one pill, over the whole group, not over the board or the items alone.
// A board is only its picture: a press on it, with Shift, adds it. The canvas is framed whole first, so a board is on screen with the items.
const person = await asPerson();
const view = (args) => fetch(`${API}/api/v1/view.move`, { method: "POST", headers: { "content-type": "application/json", ...person, "x-decks-agent": agentId }, body: JSON.stringify({ args }) });
const before = await canvas.evaluate(() => globalThis.__decksRust.camera);
await canvas.locator("[aria-label='Fit everything on the canvas']").first().click();
await rest(page);
const [box2, two2] = await canvas.evaluate(() => ["pill-box", "pill-two"].map((id) => window.__decksPenBox(id).toJSON()));
let press;
/*
 * A board whose top is on screen first: the pill goes 10 px above the group only when that slot is in
 * the window, and under it otherwise (a board whose top was above the window put it under the group).
 */
const boards = await canvas.evaluate(() => window.__decksBoards().map(({ path, rect }) => ({ path, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom } })));
boards.sort((a, b) => Number(a.rect.y < 140) - Number(b.rect.y < 140));
for (const one of boards) {
	const rect = { x: one.rect.x, y: one.rect.y, right: one.rect.right, bottom: one.rect.bottom };
	// The stage says which board's picture is under a point (`Stage.tsx`).
	const points = await canvas.evaluate(({ path, rect: r }) => {
		const out = [];
		const stage = document.querySelector(".stage");
		for (const [fx, fy] of [[0.5, 0.1], [0.3, 0.3], [0.7, 0.5], [0.2, 0.8]]) {
			const x = r.x + r.width * fx;
			const y = r.y + r.height * fy;
			if (x > 60 && x < 1340 && y > 90 && y < 860 && stage?.contains(document.elementFromPoint(x, y)) && window.__decksPictureAt(x, y) === path) out.push({ x, y });
		}
		return out;
	}, one);
	for (const at of points) if (!press && (await onCanvasAt(page, at.x, at.y))) press = { ...at, path: one.path, rect };
	if (press) break;
}
say("a board is on screen to add", !!press);
if (press) {
	await page.keyboard.down("Shift");
	await page.mouse.click(press.x, press.y);
	await page.keyboard.up("Shift");
	await settle(page, 400);
	const group = await canvas.evaluate(() => {
		const pills = [...document.querySelectorAll(".stage-fixed > .board-callout:not([data-hidden])")];
		const r = pills[0]?.getBoundingClientRect();
		return { pills: pills.length, label: pills[0]?.getAttribute("aria-label") ?? pills[0]?.querySelector("[aria-label]")?.getAttribute("aria-label"), top: r?.top, bottom: r?.bottom, middle: r && (r.left + r.right) / 2 };
	});
	const left = Math.min(box2.x, two2.x, press.rect.x);
	const right = Math.max(box2.x + box2.width, two2.x + two2.width, press.rect.right);
	const groupTop = Math.min(box2.y, two2.y, press.rect.y);
	const groupBottom = Math.max(box2.y + box2.height, two2.y + two2.height, press.rect.bottom);
	const middle = (left + right) / 2;
	// Above the group, or under it when the slot above is under the top bar (the whole canvas is framed, so the group reaches the top).
	say(
		"a group with a board has one pill, 10 px above or under the whole group and centred on it",
		group.pills === 1 && (Math.abs(groupTop - group.bottom - 10) < 1.5 || Math.abs(group.top - groupBottom - 10) < 1.5) && Math.abs(group.middle - middle) < 2,
		JSON.stringify({ ...group, groupTop, groupBottom, middle }),
	);
}

// Back to the view the box was measured in.
for (let i = 0; i < 4; i++) {
	await view([{ x: before.x, y: before.y, zoom: before.zoom }]);
	if (await until(() => canvas.evaluate((b) => Math.abs(globalThis.__decksRust.camera.x - b.x) < 1 && Math.abs(globalThis.__decksRust.camera.zoom - b.zoom) < 0.001, before), 3000)) break;
}
await rest(page);

/*
 * Two slots only, over the top edge and under the bottom one, and the one that covers nothing else:
 * with an item just above the box, the pill goes under it, on neither the box nor the item above.
 */
link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "insert", node: { type: "rectangle", id: "pill-roof", fill: "#7a7a7a" }, box: { x1: spot.x - 40 / spot.zoom, y1: spot.y - 70 / spot.zoom, x2: spot.x + w + 40 / spot.zoom, y2: spot.y - 20 / spot.zoom } }] });
const roof = await until(() => canvas.evaluate(() => window.__decksPenBox?.("pill-roof")));
await page.keyboard.press("Escape");
await settle(page, 300);
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await settle(page, 400);
const under = await canvas.evaluate(() => {
	const r = document.querySelector(".stage-fixed > .board-callout:not([data-hidden])")?.getBoundingClientRect();
	return r && { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
});
const hits = (a, b) => a && b && a.x < b.x + b.width && a.right > b.x && a.y < b.y + b.height && a.bottom > b.y;
say(
	"with an item just above, the pill goes under the box, on neither",
	!!under && !!roof && under.y >= box.y + box.height && !hits(under, roof) && !hits(under, box),
	JSON.stringify({ under, roof, box }),
);

/*
 * Panned away, the pill keeps its edge: it goes with the box, still under it and centred on it, not
 * pushed back onto the screen or over to the other edge.
 */
if (under) {
	await page.mouse.move(1000, 700);
	for (let i = 0; i < 8; i++) {
		await page.mouse.wheel(90, 0);
		await page.waitForTimeout(30);
	}
	await settle(page, 700);
	const moved = await canvas.evaluate(() => window.__decksPenBox?.("pill-box"));
	const after = await canvas.evaluate(() => {
		const r = document.querySelector(".stage-fixed > .board-callout:not([data-hidden])")?.getBoundingClientRect();
		return r && { x: r.x, y: r.y, width: r.width };
	});
	const centred = moved && after && Math.abs(after.x + after.width / 2 - (moved.x + moved.width / 2)) < 2;
	say("panned away, the pill stays under the box and centred on it", !!moved && moved.x < box.x - 200 && centred && after.y >= moved.y + moved.height, JSON.stringify({ moved, after }));
}

say("no errors on the page", errors.length === 0, errors.join(" | "));
link.close?.();
await browser.close();
