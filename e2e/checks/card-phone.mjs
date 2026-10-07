/**
 * A card on a phone, by touch (`pen/CardEditor.tsx`, `pen/card-frame.ts`).
 *
 * The same card a desk sees, held in a finger: a double tap opens it as it reads, inside the screen;
 * a tap accepts an agent's suggestion; words typed go into it and a tap on the canvas saves them;
 * a selection gets the style bar on the screen; and a finger carries a picture into the card. The
 * properties sheet opens only on a second tap on what is selected, and stands aside while a card is
 * open: on a phone it covers most of the screen.
 *
 * Needs no model: the card goes in over the wire.
 */
import { open, say, settle, socket, deckState } from "../harness.mjs";
import { readFileSync, readdirSync } from "node:fs";

const until = async (test, ms = 8000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test();
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
};
const deck = await deckState();
const cardNode = () => {
	for (const stage of readdirSync(`${deck.path}/stages`)) {
		try {
			const card = (JSON.parse(readFileSync(`${deck.path}/stages/${stage}/stage.pen`, "utf8")).children ?? []).find((n) => n.id === "phone-card");
			if (card) return card;
		} catch {
			/* being written */
		}
	}
};
const block = (id, content) => ({ type: "text", id, content, textGrowth: "fixed-width", width: "fill_container", metadata: { type: "decks.markdown" } });

const { browser, page, errors } = await open({ device: "iPhone 14 Pro", scheme: "light", boards: false });
await settle(page, 1500);
const link = await socket();
const agentId = await until(() => link.last("agents")?.focused);
const view = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));

// Near life size, and off to the side of the boards, so the card has the screen to itself.
const matrix = () => page.evaluate(() => {
	const m = new DOMMatrix(getComputedStyle(document.querySelector(".world")).transform);
	return { a: m.a, e: m.e, f: m.f };
});
for (let i = 0; i < 30; i++) {
	const { a } = await matrix();
	if (a > 0.85 && a < 1.2) break;
	await page.keyboard.press(a <= 0.85 ? "=" : "-");
	await settle(page, 120);
}
const clear = () => page.evaluate(({ w }) => {
	const stage = document.querySelector(".stage");
	// On a phone the stage's own surface answers for bare canvas as well as the stage.
	const bare = (el) => el === stage || el?.classList?.contains("surface");
	for (let y = 130; y <= 400; y += 40) for (let x = 40; x <= w - 40; x += 40) if (!bare(document.elementFromPoint(x, y))) return false;
	return true;
}, view);
for (let i = 0; i < 14 && !(await clear()); i++) {
	await page.mouse.move(view.w / 2, 400);
	await page.mouse.wheel(i % 2 ? 0 : 1200, i % 2 ? 900 : 0);
	await settle(page, 200);
}
let m = await matrix();
for (let i = 0; i < 20; i++) {
	await settle(page, 250);
	const now = await matrix();
	if (now.e === m.e && now.f === m.f && now.a === m.a) break;
	m = now;
}
say("the phone's canvas has room for a card", await clear(), JSON.stringify(view));
const world = (x, y) => ({ x1: Math.round((x - m.e) / m.a), y1: Math.round((y - m.f) / m.a) });
const at = world(30, 110);
link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "delete", id: "phone-card" }] });
link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "delete", id: "phone-picture" }] });
await settle(page, 400);
link.send({
	type: "stage.pen.edit",
	agentId,
	ops: [
		{
			op: "insert",
			node: { type: "frame", id: "phone-card", name: "Kyoto", layout: "vertical", gap: 14, padding: 16, cornerRadius: 12, metadata: { type: "decks.card" }, children: [block("p-h", "# Kyoto"), block("p-a", "Arrive **Thursday**, ask about {~~Arashiyama~>Ohara~~}."), block("p-l", "- one\n- two")] },
			box: { ...at, x2: at.x1 + Math.round((view.w - 60) / m.a) },
		},
	],
});
const box = await until(async () => {
	const now = await page.evaluate(() => globalThis.__decksPenBox?.("phone-card"));
	return now && now.height > 80 ? now : undefined;
}, 12000);
say("a card is drawn on the phone", !!box, JSON.stringify(box && { w: Math.round(box.width), h: Math.round(box.height) }));

// A double tap on its words opens it as it reads, and the editor stays inside the screen.
await page.touchscreen.tap(box.x + 40, box.y + 30);
await page.waitForTimeout(120);
await page.touchscreen.tap(box.x + 40, box.y + 30);
const opened = await until(() => page.evaluate(() => {
	const editor = document.querySelector(".pen-card-editor");
	if (!editor) return undefined;
	const r = editor.getBoundingClientRect();
	return { left: Math.round(r.left), right: Math.round(r.right), focused: !!document.activeElement?.closest(".pen-card-editor") };
}), 3000);
say("a double tap opens the card as it reads, inside the screen", !!opened && opened.left >= 0 && opened.right <= view.w, JSON.stringify({ ...opened, screen: view.w }));

// A tap on ✓ accepts the suggestion.
const accept = await page.evaluate(() => document.querySelector(".pce-sug [data-accept]")?.getBoundingClientRect().toJSON());
if (accept) await page.touchscreen.tap(accept.x + accept.width / 2, accept.y + accept.height / 2);
const accepted = await until(() => page.evaluate(() => !document.querySelector(".pce-sug") && document.querySelector(".pce-body").textContent.includes("about Ohara")), 2000);
say("a tap on ✓ accepts an agent's suggestion", !!accepted);

// A selection gets the style bar, on the screen.
await page.evaluate(() => {
	const text = document.querySelector(".pce-body > p").firstChild;
	const range = document.createRange();
	range.setStart(text, 0);
	range.setEnd(text, 6);
	getSelection().removeAllRanges();
	getSelection().addRange(range);
});
const bar = await until(() => page.evaluate(() => {
	const el = document.querySelector(".pce-bar");
	if (!el || getComputedStyle(el).display === "none") return undefined;
	const r = el.getBoundingClientRect();
	return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top) };
}), 2000);
say("a selection gets the style bar, inside the screen", !!bar && bar.left >= 0 && bar.right <= view.w && bar.top >= 0, JSON.stringify({ ...bar, screen: view.w }));

// Words typed at the end go in, and a tap on the canvas saves them.
await page.evaluate(() => {
	const p = document.querySelector(".pce-body > p");
	const range = document.createRange();
	range.selectNodeContents(p);
	range.collapse(false);
	getSelection().removeAllRanges();
	getSelection().addRange(range);
});
await page.keyboard.type(" Then rest.");
await page.touchscreen.tap(view.w / 2, Math.min(view.h - 260, box.y + box.height + 120));
const saved = await until(() => cardNode()?.children?.find((n) => n.id === "p-a")?.content === "Arrive **Thursday**, ask about Ohara. Then rest.");
say("words typed by the phone's keyboard go in, and a tap on the canvas saves them", !!saved, JSON.stringify(cardNode()?.children?.map((n) => n.content)));
say("…as one edit to that block: the others keep their ids", JSON.stringify(cardNode()?.children?.map((n) => n.id)) === JSON.stringify(["p-h", "p-a", "p-l"]), JSON.stringify(cardNode()?.children?.map((n) => n.id)));

// A finger picks a picture with a tap, with no sheet over the canvas, and carries it into the card.
await settle(page, 600);
const drawn = await page.evaluate(() => globalThis.__decksPenBox?.("phone-card"));
const spot = world(view.w / 2 - 60, Math.min(view.h - 300, drawn.y + drawn.height + 40));
link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "insert", node: { type: "rectangle", id: "phone-picture", name: "Gate", cornerRadius: 8, fill: "#9ec5f0" }, box: { ...spot, x2: spot.x1 + 120, y2: spot.y1 + 68 } }] });
const picture = await until(() => page.evaluate(() => globalThis.__decksPenBox?.("phone-picture")));
const first = await page.evaluate(() => globalThis.__decksPenBox?.("p-h"));
const sheet = () => page.evaluate(() => !!document.querySelector(".props-panel"));
await page.touchscreen.tap(picture.x + picture.width / 2, picture.y + picture.height / 2);
await settle(page, 400);
say("a tap on a picture selects it and leaves the canvas clear: no properties sheet", !(await sheet()));
const cdp = await page.context().newCDPSession(page);
const point = (x, y) => [{ x, y, radiusX: 4, radiusY: 4, force: 1, id: 1 }];
const from = { x: picture.x + picture.width / 2, y: picture.y + picture.height / 2 };
const to = { x: first.x + 80, y: first.y + first.height + 6 };
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(from.x, from.y) });
let ghost;
for (let i = 1; i <= 16; i++) {
	await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: point(from.x + ((to.x - from.x) * i) / 16, from.y + ((to.y - from.y) * i) / 16) });
	await page.waitForTimeout(16);
}
await settle(page, 150);
ghost = await page.evaluate(() => document.querySelector(".pen-selection")?.getBoundingClientRect().toJSON());
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
const placed = await until(() => {
	const kids = cardNode()?.children?.map((n) => n.id) ?? [];
	return kids.indexOf("phone-picture") === 1 ? kids : undefined;
});
say("a picture carried by a finger drops between two of the card's blocks", !!placed, JSON.stringify(cardNode()?.children?.map((n) => n.id)));
say("…riding below and right of the finger over the card, clear of it", !!ghost && ghost.x > to.x + 10 && ghost.y > to.y + 10, JSON.stringify({ finger: to, at: ghost && { x: Math.round(ghost.x), y: Math.round(ghost.y) } }));

// A second tap on what is selected asks for its properties: the sheet.
const inCard = await until(async () => {
	const now = await page.evaluate(() => globalThis.__decksPenBox?.("phone-picture"));
	return now && Math.abs(now.y - picture.y) > 20 ? now : undefined;
});
await page.touchscreen.tap(inCard.x + inCard.width / 2, inCard.y + inCard.height / 2);
await settle(page, 600);
const selectedNow = await sheet();
if (!selectedNow) {
	await page.touchscreen.tap(inCard.x + inCard.width / 2, inCard.y + inCard.height / 2);
	await settle(page, 400);
}
say("a second tap on the selected picture opens its properties sheet", await until(sheet, 2000));

link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "delete", id: "phone-card" }] });
link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "delete", id: "phone-picture" }] });
await settle(page, 300);
say("no page errors", !errors.length, errors.slice(0, 3).join(" | "));
link.close();
await browser.close();
