/**
 * Where a board lands when nobody said where, and whether the camera goes with it.
 *
 * Two routes, both of which used to drop a board somewhere nobody would find it. A board picked
 * out of the rail kept whatever place it was last given — and every board a stage has ever been
 * sent carries one from the deck-wide auto-layout, which stacks the whole deck into a column
 * hundreds of thousands of pixels tall. The ＋ in the corner made a board at the bottom of that
 * column and left the camera where it was.
 *
 * So the two things asserted here are the two halves of the rule: the board arrives near what is
 * already on the canvas, and the view ends up holding it. Read off the screen rather than off the
 * deck state, because "can the person see it" is a question about pixels.
 */
import { open, openPanel, resetStage, say, settle, socket } from "../harness.mjs";

const { browser, page, errors } = await open({ width: 1500, height: 1000 });
await resetStage(page);
await settle(page, 900);

/** Every board on the canvas, as boxes on screen. */
const onScreen = () =>
	page.evaluate(() => {
		const view = { w: window.innerWidth, h: window.innerHeight };
		return [...document.querySelectorAll(".board-node")].map((node) => {
			const box = node.getBoundingClientRect();
			return {
				path: node.dataset.path,
				x: Math.round(box.x),
				y: Math.round(box.y),
				w: Math.round(box.width),
				h: Math.round(box.height),
				inView: box.right > 0 && box.bottom > 0 && box.x < view.w && box.y < view.h,
			};
		});
	});

const paths = await page.evaluate(() => [...document.querySelectorAll(".board-node")].map((node) => node.dataset.path));
say("the fixture has boards to be placed among", paths.length >= 2, JSON.stringify(paths));

// --- a board picked out of the rail, from the far end of the old column ----------------

const stray = paths.at(-1);
const link = await socket();
/* Off the canvas and half a million pixels down: the place the deck-wide layout used to give a
   board that nobody had put anywhere. */
link.send({ type: "board.hide", path: stray });
link.send({ type: "board.move", path: stray, x: 0, y: 520_000 });
await settle(page, 700);

const staying = await onScreen();
say("…and one of them is off the canvas, with a place far from the rest", !staying.some((board) => board.path === stray), stray);

await openPanel(page);
await settle(page, 400);
await page.evaluate((name) => [...document.querySelectorAll(".board-row")].find((row) => row.textContent?.includes(name))?.click(), stray.split("/").pop());
await settle(page, 2200);

const after = await onScreen();
const back = after.find((board) => board.path === stray);
say("a board picked out of the rail comes back to the canvas", back !== undefined, JSON.stringify(after.map((b) => b.path)));
say("…and the camera arrives on it, rather than leaving it off screen", back?.inView === true, JSON.stringify(back));
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

// --- the ＋ in the corner ---------------------------------------------------------------

await openPanel(page);
await settle(page, 300);
const before = new Set((await onScreen()).map((board) => board.path));
await page.locator('button[aria-label="A new board, on the canvas"]').click();
await settle(page, 300);
await page.locator(".popover [data-row]").first().click();
await settle(page, 2500);

const made = (await onScreen()).find((board) => !before.has(board.path));
say("the ＋ in the corner makes a board on the canvas", made !== undefined, JSON.stringify((await onScreen()).map((b) => b.path)));
say("…in the view, not at the bottom of the deck", made?.inView === true, JSON.stringify(made));
const neighbours = (await onScreen()).filter((board) => board.path !== made?.path);
say(
	"…beside the boards that were already on the canvas",
	made !== undefined && nearest(made, neighbours) < made.w,
	`${made ? Math.round(nearest(made, neighbours)) : "?"} px to the nearest, on a board ${made?.w} wide`,
);

say("no page errors", errors.length === 0, errors.join("; "));
link.close();
await browser.close();
