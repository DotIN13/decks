/**
 * The focus view: the canvas as one page.
 *
 * A *view* of the canvas rather than an overlay — the chrome stays, so the inspector, the
 * composer and every panel work exactly as they do beside the canvas — and not a camera trick
 * either: the canvas is not rendered at all, and this is a separate box with its own scroll and
 * its own zoom. That is the whole assertion here, because it is the whole design: one board in
 * the document, and every lookup in this app that asks "where is board X's frame" — the
 * inspector's shape, the editor's patch target — finds exactly one answer.
 *
 * The board is the flow fixture, because it is the one board in this deck that is longer than
 * the window and "scroll easily" is what the view is for.
 */
import { editMode, open, say, settle } from "../harness.mjs";

const { browser, page, errors } = await open({ width: 1440, height: 1000 });
const NOTES = "boards/notes.html";

/*
 * Bring it up the way a person would: its row in the panel, which puts the board on the canvas
 * *and* flies the camera to it (`App`'s `onPick`) — so the frame and its title bar are where
 * this check needs them without a keypress.
 */
await page.locator('.panel-shell [title^="What the survey round found"]').first().click();
await settle(page, 900);
const onCanvas = await page.locator(`.board-node[data-path="${NOTES}"]`).count();
say("the flow board is on the canvas to focus on", onCanvas === 1, `${onCanvas} node(s)`);

/*
 * The button, not the key: the bar above *this* board is where the affordance lives — beside
 * the file's address, filling the window, and taking the board away — and the key is the
 * shorthand for the same thing.
 */
const bar = await page.evaluate((path) => {
	const acts = document.querySelector(`.board-node[data-path="${path}"] .chrome .acts`);
	return [...(acts?.children ?? [])].map((child) => child.className);
}, NOTES);
say(
	"the bar above the board offers focus, its address, fullscreen and going away",
	bar.length === 4 && bar[0] === "focus-open" && bar.includes("open-tab") && bar.includes("present-open") && bar.includes("hide"),
	JSON.stringify(bar),
);

// A marker on every frame's own window before the view changes, and counted again after: a
// reload takes it with it, so "the canvas was not taken apart" is a fact rather than a hope.
// (The admission has its own policy about boards the *camera* has left, so this is reported
// rather than asserted — what is asserted is that the same boards are on the canvas after.
const markedBefore = await page.evaluate(() => {
	const frames = [...document.querySelectorAll(".board-node iframe")];
	// Only frames that have finished loading can hold a marker; the rest were never anywhere.
	let marked = 0;
	for (const frame of frames) {
		if (!frame.contentWindow) continue;
		try {
			frame.contentWindow.__still = 1;
			marked += 1;
		} catch {
			/* an opaque frame cannot be marked, and cannot be a board of ours */
		}
	}
	return marked;
});
await page.locator(`.board-node[data-path="${NOTES}"] .chrome .focus-open`).click();
await settle(page, 700);

const state = () =>
	page.evaluate(() => {
		const box = document.querySelector(".focus");
		const page_ = document.querySelector(".focus-page");
		const panel = document.querySelector('aside[aria-label="Boards"]')?.getBoundingClientRect();
		const box_ = box?.getBoundingClientRect();
		const world = document.querySelector(".world");
		return {
			open: Boolean(box),
			world: Boolean(world),
			// Put away rather than taken apart — the two halves of "not there" that matter.
			worldHidden: world ? getComputedStyle(world).visibility === "hidden" : false,
			worldInert: world ? world.hasAttribute("inert") && getComputedStyle(world).pointerEvents === "none" : false,
			worldNodes: [...document.querySelectorAll(".world .board-node")].map((node) => node.dataset.path),
			nodes: [...document.querySelectorAll(".board-node")].map((node) => node.dataset.path),
			page: page_ ? { w: Math.round(page_.getBoundingClientRect().width), centre: Math.round(page_.getBoundingClientRect().x + page_.getBoundingClientRect().width / 2) } : null,
			beside: panel ? Math.round(panel.right + (innerWidth - panel.right) / 2) : null,
			scrollable: box ? box.scrollHeight > box.clientHeight + 40 : false,
			scrollTop: box?.scrollTop ?? -1,
			survived: [...document.querySelectorAll(".board-node iframe")].filter((frame) => frame.contentWindow?.__still === 1).length,
			box: box_ ? { w: Math.round(box_.width), h: Math.round(box_.height) } : null,
		};
	});

const focused = await state();
say(
	"the board's own button turns the canvas into one page",
	focused.open && focused.worldHidden && focused.worldInert,
	JSON.stringify({ open: focused.open, hidden: focused.worldHidden, inert: focused.worldInert }),
);
say(
	"…with the canvas put away rather than taken apart",
	focused.worldNodes.length > 0 && !focused.worldNodes.includes(NOTES),
	`${focused.worldNodes.length} board(s) still mounted behind it, this one excluded`,
);
say(
	"…so exactly one element carries this board, and it is the one on screen",
	focused.nodes.filter((path) => path === NOTES).length === 1,
	JSON.stringify(focused.nodes),
);
say(
	"…centred in the room beside the panel rather than under it",
	focused.page !== null && Math.abs((focused.page?.centre ?? 0) - (focused.beside ?? 0)) <= 6,
	`page centre ${focused.page?.centre} vs the room's ${focused.beside}`,
);

/*
 * A page that fits proves nothing about a view whose point is scrolling, so the zoom goes up
 * until it does not fit — which is also the assertion that the zoom keys belong to the page in
 * this view.
 */
let taller = focused.scrollable;
for (let i = 0; i < 8 && !taller; i++) {
	await page.keyboard.press("Control+Equal");
	await settle(page, 300);
	taller = (await state()).scrollable;
}
say("…and zooming in makes it longer than the window, which is what scrolling is for", taller, `scrollable: ${taller}`);
say("…the page still filling its box rather than the frame's", (await state()).page !== null, "page present");

const before = (await state()).scrollTop;
await page.mouse.move(720, 500);
await page.mouse.wheel(0, 400);
await settle(page, 400);
const after = (await state()).scrollTop;
say("a wheel over the page scrolls it", after > before, `${before} → ${after}`);

/*
 * And the chrome is untouched, so the document is still the one being worked on: turning
 * editing on gives the inspector to the *same* frame, because the view did not mount a second
 * one.
 */
await editMode(page);
await settle(page, 400);
const editable = await page.evaluate((path) => {
	const nodes = [...document.querySelectorAll(`.board-node[data-path="${path}"]`)];
	const frame = nodes[0]?.querySelector("iframe");
	return {
		copies: nodes.length,
		inFocus: Boolean(nodes[0]?.closest(".focus")),
		frame: Boolean(frame),
		mode: document.querySelector(".stage")?.dataset.mode,
	};
}, NOTES);
say(
	"…and editing finds that board's frame — the one on screen, and the only one",
	editable.copies === 1 && editable.inFocus && editable.frame && editable.mode === "edit",
	JSON.stringify(editable),
);

await page.keyboard.press("Escape");
await settle(page, 700);
const returned = await state();
say(
	"Escape puts the canvas back, with the same boards on it",
	!returned.open && !returned.worldHidden && !returned.worldInert && returned.nodes.length === focused.nodes.length && returned.nodes.length > 1,
	JSON.stringify({ hidden: returned.worldHidden, inert: returned.worldInert, nodes: returned.nodes.length, marked: markedBefore }),
);

say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
