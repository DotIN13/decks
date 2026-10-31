/**
 * A card that is news, looked at: selecting it reads it, and its dot goes.
 *
 * A card is news when something changed it that the person has not read since (`items/news.ts`):
 * here, the person's own resize names them its writer, and the file changing after that, as an agent
 * or a script writing it would, makes it news. Selecting it in the canvas frame says it was read
 * (`Stage`'s `onRead`, the frame's `card-seen`); the harness stamps it read and the frame's dot for it
 * goes. Said once: a second selection of the same unchanged card sends nothing more.
 */
import { API, asPerson, canvasFrame, deckState, open, read, resetStage, say, selectCard, settle, write } from "../harness.mjs";

const { browser, page, errors } = await open({ width: 1500, height: 950 });
await resetStage(page);
await settle(page, 900);
const canvas = await canvasFrame(page);

const call = async (verb, args = [], headers = {}) => {
	const response = await fetch(`${API}/api/v1/${verb}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ args }) });
	return response.json();
};
const person = await asPerson();
const me = (await call("agent.me", [], person)).value;
const agent = { ...person, "x-decks-agent": me.id };

// The frame's posts of `card-seen`, counted.
const seenPosts = [];
page.on("request", (request) => {
	if (request.method() === "POST" && /\/api\/v1\/card-seen$/.test(request.url())) seenPosts.push(request.postData() ?? "");
});

// A card on the canvas on screen (the fixture's plan).
const onStage = await canvas.evaluate(() => (window.__decksCards?.() ?? []).map((one) => one.path));
const deck = await deckState();
const card = deck.boards.find((board) => board.path === "canvases/auth-refresh/cards/plan/index.html" && onStage.includes(board.path)) ?? deck.boards.find((board) => onStage.includes(board.path));
say("a card is on the canvas on screen", Boolean(card), JSON.stringify(onStage));

const newsNow = () => canvas.evaluate(() => window.__decksFrameNews?.() ?? {});
const waitFor = async (test, ms = 10000) => {
	const until = Date.now() + ms;
	while (Date.now() < until) {
		if (await test()) return true;
		await page.waitForTimeout(150);
	}
	return false;
};

if (card) {
	// Not news to start with, then named the person's by their resize, then changed after that.
	const resized = await call("resize", [card.path, { w: (card.w ?? 800) + 24 }], agent);
	say("the person's resize names them the card's writer", resized.ok !== false, JSON.stringify(resized).slice(0, 200));
	await page.waitForTimeout(1500);
	const file = `${deck.path}/${card.path}`;
	write(file, `${read(file)}\n<!-- changed elsewhere -->\n`);
	const became = await waitFor(async () => card.path in (await newsNow()));
	say("the card changed after that is news in the frame", became, JSON.stringify(await newsNow()));

	const before = seenPosts.length;
	await selectCard(page, card.path);
	const cleared = await waitFor(async () => !(card.path in (await newsNow())));
	say("selecting it clears its dot", cleared, JSON.stringify(await newsNow()));
	say("…by one card-seen from the frame", seenPosts.length - before === 1, `${seenPosts.length - before} posts: ${seenPosts.slice(before).join(" | ")}`);
	const stamped = (await deckState()).boards.find((board) => board.path === card.path);
	say("…which the harness keeps as read", (stamped?.seenAt ?? 0) >= Math.max(stamped?.modifiedAt ?? 0, stamped?.namedAt ?? 0), JSON.stringify({ seenAt: stamped?.seenAt, modifiedAt: stamped?.modifiedAt, namedAt: stamped?.namedAt }));

	// Pressed off and on again, unchanged: nothing more is said.
	await page.keyboard.press("Escape");
	await page.waitForTimeout(300);
	const again = seenPosts.length;
	await selectCard(page, card.path);
	await page.waitForTimeout(800);
	say("selecting it again, unchanged, says nothing more", seenPosts.length === again, `${seenPosts.length - again} more posts`);
}

say("no console errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await browser.close();
