/**
 * The pill over a selected item leaves its arrow handle free.
 *
 * A selected drawn item shows four places an arrow can leave from, 14 px out from each side; the
 * pill over it used to sit 10 px above the item, on top of the top one, so a press there opened no
 * arrow. While those handles show, the pill sits clear of them with 6 px between.
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
await editMode(page, true);

// An empty place in the middle of the screen, in stage units, with room above it for the pill.
const spot = await page.evaluate(() => {
	const m = new DOMMatrix(getComputedStyle(document.querySelector(".world")).transform);
	return { x: (560 - m.e) / m.a, y: (420 - m.f) / m.a, zoom: m.a };
});
const w = 200 / spot.zoom;
const h = 120 / spot.zoom;
link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "insert", node: { type: "rectangle", id: "pill-box", fill: "#4c8bf5" }, box: { x1: spot.x, y1: spot.y, x2: spot.x + w, y2: spot.y + h } }] });
const box = await until(() => page.evaluate(() => window.__decksPenBox?.("pill-box")));
say("the box is on screen", !!box, JSON.stringify(box));

await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await until(() => page.locator(".stage > .board-callout:not([data-hidden])").count());
// The pill fades in from 4 px lower: measure it at rest.
await settle(page, 300);
const anchor = await until(() => page.locator('.pen-anchor[data-side="top"]').boundingBox());
const pill = await until(() => page.locator(".stage > .board-callout:not([data-hidden])").boundingBox());
say("a selected box shows its top arrow handle and the pill", !!anchor && !!pill, JSON.stringify({ anchor, pill }));
const clear = anchor && pill ? anchor.y - (pill.y + pill.height) : NaN;
say("the pill sits above the handle, 6 px clear of it", Math.abs(clear - 6) < 1.5, `${clear.toFixed?.(1)} px`);
const free = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.classList.contains("pen-anchor"), { x: anchor.x + anchor.width / 2, y: anchor.y + anchor.height / 2 });
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
const two = await until(() => page.evaluate(() => window.__decksPenBox?.("pill-two")));
await page.keyboard.press("Escape");
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.keyboard.down("Shift");
await page.mouse.click(two.x + two.width / 2, two.y + two.height / 2);
await page.keyboard.up("Shift");
await settle(page, 400);
const both = await page.evaluate(() => ({ anchors: document.querySelectorAll(".pen-anchor").length, pill: document.querySelector(".stage > .board-callout:not([data-hidden])")?.getBoundingClientRect().bottom }));
const top = Math.min(box.y, two.y);
say("two selected have no handles, and the pill sits 10 px above them", both.anchors === 0 && Math.abs(top - both.pill - 10) < 1.5, JSON.stringify({ ...both, top }));

// A group with a board in it: one pill, over the whole group, not over the board or the items alone.
const press = await page.evaluate(() => {
	for (const one of window.__decksBoards()) {
		const node = document.querySelector(`.board-node[data-path="${CSS.escape(one.path)}"]`) ?? { picture: true, dataset: { path: one.path }, getBoundingClientRect: () => one.rect };
		const r = node.getBoundingClientRect();
		for (const [fx, fy] of [[0.5, 0.1], [0.3, 0.3], [0.7, 0.5], [0.2, 0.8]]) {
			const x = r.x + r.width * fx;
			const y = r.y + r.height * fy;
			const at = document.elementFromPoint(x, y);
			if (x > 60 && x < 1340 && y > 90 && y < 860 && (node.picture ? at === document.querySelector(".stage") && window.__decksPictureAt(x, y) === node.dataset.path : at?.closest(".board-node") === node) && !at.closest("a, button"))
				return { x, y, path: node.dataset.path, rect: { x: r.x, y: r.y, right: r.right, bottom: r.bottom } };
		}
	}
});
say("a board is on screen to add", !!press);
if (press) {
	await page.keyboard.down("Shift");
	await page.mouse.click(press.x, press.y);
	await page.keyboard.up("Shift");
	await settle(page, 400);
	const group = await page.evaluate(() => {
		const pills = [...document.querySelectorAll(".stage > .board-callout:not([data-hidden])")];
		const r = pills[0]?.getBoundingClientRect();
		return { pills: pills.length, label: pills[0]?.getAttribute("aria-label") ?? pills[0]?.querySelector("[aria-label]")?.getAttribute("aria-label"), bottom: r?.bottom, middle: r && (r.left + r.right) / 2 };
	});
	const left = Math.min(box.x, two.x, press.rect.x);
	const right = Math.max(box.x + box.width, two.x + two.width, press.rect.right);
	const groupTop = Math.min(top, press.rect.y);
	const middle = (left + right) / 2;
	say(
		"a group with a board has one pill, 10 px above the whole group and centred on it",
		group.pills === 1 && Math.abs(groupTop - group.bottom - 10) < 1.5 && Math.abs(group.middle - middle) < 2,
		JSON.stringify({ ...group, groupTop, middle }),
	);
}

say("no errors on the page", errors.length === 0, errors.join(" | "));
link.close?.();
await browser.close();
