/**
 * Opening a card for typing does not move the canvas, whatever the browser would like to scroll for.
 *
 * Opening a card for typing puts the caret at the end of its words, and the browser scrolls the
 * nearest scroll area it can to show a focused caret. The stage is one now: its scroll is the
 * camera's position (`camera/scroll-area.ts`). Once, with the stage unable to scroll and the camera
 * not knowing, a card taller than the window slid the whole stage up for good; now such a scroll
 * would move the camera instead. Either way the canvas must stay where it was: the editors take the
 * caret without scrolling (`focus({ preventScroll: true })`), and this holds them to it.
 *
 * Needs no model: a card goes in over the wire, and the rest is one double-click.
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
const { browser, page, errors } = await open({ width: 1200, height: 800 });
await rest(page, { start: 0 });
const link = await socket();
const agentId = await until(() => link.last("agents")?.focused);
await editMode(page, true);

const clear = await page.evaluate(() => {
	const stage = document.querySelector(".stage");
	const m = new DOMMatrix(globalThis.__decksCameraTransform());
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
		const before = await scrolled();
		await page.mouse.dblclick(clear.screen.x + 40, clear.screen.y + 40);
		await settle(page, 900);
		// A markdown note opens the card editor; any other text, the plain one.
		const typing = await page.evaluate(() => !!(document.activeElement?.closest(".pen-card-editor") || document.querySelector(".pen-text")));
		const during = await scrolled();
		say("a double-click opens its words for typing", typing, JSON.stringify(during));
		say("…and the stage does not scroll to show the caret", during.top === before.top && during.left === before.left, JSON.stringify({ before, during }));
		await page.keyboard.press("Escape");
		await settle(page, 600);
		const after = await scrolled();
		say("…nor is it left scrolled once the editor closes", after.top === before.top && after.left === before.left, JSON.stringify({ before, after }));
	}
	link.send({ type: "stage.pen.edit", agentId, ops: [{ op: "delete", id: "tall" }] });
	await settle(page, 300);
}

await editMode(page, false);
link.close();
say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
