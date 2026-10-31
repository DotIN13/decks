/**
 * Where a board lands when nobody said where, and whether the camera goes with it.
 *
 * Two routes, both of which used to drop a board somewhere nobody would find it. A board picked
 * out of the rail kept whatever place it was last given — and every board a stage has ever been
 * sent carries one from the deck-wide auto-layout, which stacks the whole deck into a column
 * hundreds of thousands of pixels tall. The ＋ in the corner made a board at the bottom of that
 * column and left the camera where it was.
 *
 * So what is asserted here is the rule: the board arrives near what is already on the canvas. Read
 * off the screen rather than off the deck state, because "can the person see it" is a question
 * about pixels.
 *
 * The rail is gone (the panel's Canvas tab lists only what is on the canvas), so a board put back
 * is put back over the wire, `board.play`, as an agent's `show` does; nothing flies the camera to
 * it, so whether it is on screen is not asserted, only where it lands. A document from the file
 * picker, with no point named, lands by the same rule.
 */
import { canvasFrame, open, resetStage, say, settle, socket } from "../harness.mjs";

const { browser, page, errors } = await open({ width: 1500, height: 1000 });
await resetStage(page);
await settle(page, 900);

/**
 * Every board on the canvas, as boxes on screen: the stage's own list, because below the live zoom
 * a board is a picture with no `.card-node` (only the selected one keeps its page).
 */
const onScreen = async () =>
	(await canvasFrame(page)).evaluate(() => {
		const view = { w: window.innerWidth, h: window.innerHeight };
		return (window.__decksCards?.() ?? []).map(({ path, rect: box }) => {
			return {
				path,
				x: Math.round(box.x),
				y: Math.round(box.y),
				w: Math.round(box.width),
				h: Math.round(box.height),
				inView: box.right > 0 && box.bottom > 0 && box.x < view.w && box.y < view.h,
			};
		});
	});

const paths = (await onScreen()).map((board) => board.path);
say("the fixture has boards to be placed among", paths.length >= 2, JSON.stringify(paths));

// --- a board put back on the canvas, from the far end of the old column ----------------

const stray = paths.at(-1);
const link = await socket();
/* Off the canvas and half a million pixels down: the place the deck-wide layout used to give a
   board that nobody had put anywhere. */
link.send({ type: "card.hide", path: stray });
link.send({ type: "card.move", path: stray, x: 0, y: 520_000 });
/*
 * Waited for rather than slept through. A hide travels socket → canvas → every browser, and
 * a fixed 700ms was enough until the canvas list started travelling with it: under a full
 * run this check failed on its second assertion about once in twenty, which reads as the
 * hide being broken rather than as the wait being short.
 */
await (await canvasFrame(page)).waitForFunction((path) => !(window.__decksCards?.() ?? []).some((one) => one.path === path), stray, { timeout: 8000 });
await settle(page, 300);

const staying = await onScreen();
say("…and one of them is off the canvas, with a place far from the rest", !staying.some((board) => board.path === stray), stray);

link.send({ type: "card.play", path: stray });
await (await canvasFrame(page)).waitForFunction((path) => (window.__decksCards?.() ?? []).some((one) => one.path === path), stray, { timeout: 8000 }).catch(() => {});
await settle(page, 1200);

const after = await onScreen();
const back = after.find((board) => board.path === stray);
say("a board put back comes back to the canvas", back !== undefined, JSON.stringify(after.map((b) => b.path)));
const others = after.filter((board) => board.path !== stray);
const clear = back !== undefined && others.every((board) => back.x > board.x + board.w || board.x > back.x + back.w || back.y > board.y + board.h || board.y > back.y + back.h);
say("…and it does not land on top of a board that was already there", clear, JSON.stringify(others.map((b) => `${b.path} ${b.x},${b.y}`)));
/*
 * The assertion the flight alone cannot fake: a camera that followed the board to where it *was*
 * would frame it just as snugly, half a million pixels from everything else. So this measures the
 * gap to the nearest board instead — in screen pixels, which is world pixels times a zoom every
 * board on the canvas shares.
 */
const gap = (a, b) => Math.max(Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w)), Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h)));
const nearest = (board, rest) => Math.min(...rest.map((other) => gap(board, other)));
say(
	"…within a board's width of the ones it joined, rather than out in the column",
	back !== undefined && nearest(back, others) < back.w,
	`${back ? Math.round(nearest(back, others)) : "?"} px to the nearest, on a board ${back?.w} wide`,
);

// --- a document from the file picker, with no point named (the toolbar's button) --------------

/*
 * Nobody makes a board any more: what the picker puts on the canvas is an item, a document opened as
 * a page (`document.create`, an item tagged `decks.document`). With no point named it takes the open
 * slot beside the newest card, by the stage's own rule (`deck/place.ts`), and the server answers with
 * its path on the stage, `item:<id>`, which is what the page selects and flies to.
 */
const before = new Set((await onScreen()).map((board) => board.path));
link.send({ type: "document.create", document: "docs/notes.md", request: "placement-1" });
const answered = await (async () => {
	for (let i = 0; i < 60; i++) {
		const heard = link.received.find((m) => m.type === "document.created" && m.request === "placement-1");
		if (heard) return heard;
		await settle(page, 150);
	}
})();
say("document.create is answered with the item's path on the stage", /^item:/.test(answered?.path ?? ""), JSON.stringify(answered));
await (await canvasFrame(page)).waitForFunction((path) => (window.__decksCards?.() ?? []).some((one) => one.path === path), answered?.path, { timeout: 8000 }).catch(() => {});
await settle(page, 600);

const made = (await onScreen()).find((board) => !before.has(board.path));
say("…and the document is on the canvas, as an item and not a board", made !== undefined && made.path === answered?.path, JSON.stringify((await onScreen()).map((b) => b.path)));
const neighbours = (await onScreen()).filter((board) => board.path !== made?.path);
say(
	"…beside the boards that were already on the canvas",
	made !== undefined && nearest(made, neighbours) < made.w,
	`${made ? Math.round(nearest(made, neighbours)) : "?"} px to the nearest, on a document ${made?.w} wide`,
);

say("no page errors", errors.length === 0, errors.join("; "));
link.close();
await browser.close();
