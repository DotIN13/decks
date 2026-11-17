/**
 * A board item left on a friend's shared canvas by a Decks from before cards.
 *
 * A card is the only page there is. The deck's own canvases hold cards, and a migration turned every
 * board on them into one. A friend's canvas is theirs and is never rewritten, so a board item on it
 * stays in its file as it is, and this Decks draws it as an item with nothing in it: no page of it
 * runs, it is no card, and the deck lists no page for it. Their own Decks turns it into a card when it
 * is updated. The fixture's one such item is on Ada's view-only canvas, `shared/ada/old-notes`.
 */
import { API, asPerson, canvasFrame, deckState, open, rest, say, settle, SHARED_BOARD, SHARED_CANVAS, socket } from "../harness.mjs";

const link = await socket();
const until = async (test, ms = 15000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test();
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
};
const agent = await until(() => link.last("agent.list")?.focused);
link.call("agent.set", [agent, { canvas: SHARED_CANVAS }]);
const opened = await until(() => link.canvasOf(agent) === SHARED_CANVAS && link.drawing(SHARED_CANVAS));
say("the focused agent opens the friend's canvas", !!opened);
link.close();

const { browser, page, errors } = await open({ width: 1400, height: 900 });
await rest(page, { start: 0 }).catch(() => {});
const canvas = await canvasFrame(page);
await settle(page, 800);

// No page: the deck lists none for it, and the canvas has no card, frame or picture of it.
const cards = await canvas.evaluate(() => (window.__decksProbes?.cards?.() ?? []).map((one) => one.path));
say("the board is no card of the canvas", !cards.includes(SHARED_BOARD), JSON.stringify(cards));
const deck = await deckState();
say("the deck lists no page for it", !(deck.library ?? []).some((one) => one.path === SHARED_BOARD), JSON.stringify((deck.library ?? []).map((one) => one.path).filter((path) => path.startsWith("shared/"))));
const live = await canvas.evaluate((path) => {
	const node = document.querySelector(`.card-node[data-path="${CSS.escape(path)}"]`);
	return { node: !!node, frames: [...document.querySelectorAll("iframe")].filter((frame) => (frame.src ?? "").includes("old-notes/boards")).length };
}, SHARED_BOARD);
say("it runs no page of its own: no card node, no frame", !live.node && live.frames === 0, JSON.stringify(live));
const held = await canvas.evaluate((path) => window.__decksProbes?.rust?.cardPictures.heldWidth?.get(`card:${path}`) ?? 0, SHARED_BOARD);
say("no picture is asked of it", held === 0, `${held}px wide`);

// Kept: the friend's drawing still holds the item as they wrote it.
const drawing = await (await fetch(`${API}/api/v1/canvas.read`, { method: "POST", headers: { ...(await asPerson(API)), "content-type": "application/json" }, body: JSON.stringify({ args: [{ canvas: SHARED_CANVAS }] }) })).json();
const items = drawing?.value?.items ?? [];
const kept = items.find((one) => one.type === "browser" && one.metadata?.type === "decks.board");
say("the item is still in the friend's drawing, as a plain browser item", !!kept, JSON.stringify(items.map((one) => [one.type, one.metadata?.type])));

say("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
