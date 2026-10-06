/**
 * The stage cannot be scrolled, whatever the browser would like to scroll it for.
 *
 * Opening a card for typing puts the caret at the end of its words. A box with `overflow: hidden`
 * has no scrollbars but is still a scroll container, and the browser scrolls the nearest one it can
 * to show a focused caret — so a card taller than the window slid the whole stage up by the card's
 * own height and nothing put it back: every board and every drawn item off screen while the camera
 * said they were in front of you. `overflow: clip` cannot scroll at all, which is the truth of this
 * surface, since the camera is what moves the canvas.
 *
 * Needs no model: a card goes in over the wire, and the rest is one double-click.
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
const { browser, page, errors } = await open({ width: 1200, height: 800 });
await settle(page, 1500);
const link = await socket();
const agentId = await until(() => link.last("agents")?.focused);
await editMode(page, true);

const clear = await page.evaluate(() => {
	const stage = document.querySelector(".stage");
	const m = new DOMMatrix(getComputedStyle(document.querySelector(".world")).transform);
	const empty = (x, y) => document.elementFromPoint(x, y) === stage;
	for (let y = 140; y < window.innerHeight - 160; y += 30) {
		for (let x = 320; x < window.innerWidth - 320; x += 30) {
			// Room for the press and a little around it; the card itself may hang over anything below.
			if ([0, 60].every((dy) => [0, 90].every((dx) => empty(x + dx, y + dy)))) return { screen: { x, y }, world: { x: (x - m.e) / m.a, y: (y - m.f) / m.a }, window: window.innerHeight };
		}
	}
});
say("the canvas has a clear place for a tall card", !!clear, JSON.stringify(clear?.screen));

const scrolled = () => page.evaluate(() => {
	const stage = document.querySelector(".stage");
	return { top: stage.scrollTop, left: stage.scrollLeft, overflow: getComputedStyle(stage).overflow };
});

if (clear) {
	/*
	 * Enough words that the card is taller than the window at whatever zoom the canvas opens on,
	 * which saves the check from having to zoom: at a fifth zoom a paragraph is a few pixels.
	 */
	const many = Array.from({ length: 200 }, (_, i) => `Line ${i + 1}: words enough to make this card taller than any window.`).join("\n\n");
	link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "insert", node: { type: "note", id: "tall", content: many, metadata: { type: "decks.markdown" }, width: 320 }, box: { x1: Math.round(clear.world.x), y1: Math.round(clear.world.y) } }] });
	const card = await until(async () => {
		const box = await page.evaluate(() => globalThis.__decksPenBox?.("tall"));
		return box && box.height > clear.window * 1.5 ? box : undefined;
	}, 12000);
	say("the card is half again the window's height", !!card, JSON.stringify({ h: Math.round(card?.height ?? 0), window: clear.window, ...(await scrolled()) }));
	if (card) {
		await page.mouse.click(clear.screen.x + 40, clear.screen.y + 40);
		await settle(page, 250);
		await page.mouse.dblclick(clear.screen.x + 40, clear.screen.y + 40);
		await settle(page, 900);
		const typing = await page.evaluate(() => !!document.querySelector("textarea.pen-text"));
		const during = await scrolled();
		say("a double-click opens its words for typing", typing, JSON.stringify(during));
		say("…and the stage does not scroll to show the caret", during.top === 0 && during.left === 0, JSON.stringify(during));
		await page.keyboard.press("Escape");
		await settle(page, 600);
		const after = await scrolled();
		say("…nor is it left scrolled once the editor closes", after.top === 0 && after.left === 0, JSON.stringify(after));
	}
	link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "delete", id: "tall" }] });
	await settle(page, 300);
}

await editMode(page, false);
link.close();
say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
