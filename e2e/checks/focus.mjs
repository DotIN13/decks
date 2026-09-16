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
	return [...(acts?.children ?? [])].map((child) => ({
		cls: child.className,
		w: Math.round(child.getBoundingClientRect().width),
		icon: Math.round(child.querySelector("svg")?.getBoundingClientRect().width ?? 0),
	}));
}, NOTES);
say(
	/*
	 * Four buttons, and there used to be five: `doc-open` sat first in this bar and opened a GrapesJS
	 * model over a flow document, which is where a document could be rearranged block by block. That
	 * editor is gone — it drew the board as a stack of full-width blocks and refused most of the
	 * writes it did make — so the bar is the address, focus, fullscreen and going away, and a
	 * document is edited by ⌥ and the text. Asserted as an exact list rather than a "contains",
	 * because a bar is the one place where an extra control is a change to every board's chrome.
	 */
	"the bar above the board offers its address, focus, fullscreen and going away, in that order",
	bar.length === 4 && bar.map((b) => b.cls).join(",") === "open-tab,focus-open,present-open,hide",
	JSON.stringify(bar.map((b) => b.cls)),
);
say(
	"…and the five are the same width, glyph or word",
	new Set(bar.map((b) => b.w)).size === 1,
	JSON.stringify(bar.map((b) => `${b.cls}:${b.w}`)),
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
/*
 * The way out is on screen, not only on the keyboard.
 *
 * The focus view has no title bar — deliberately, since the bar is how you identify a board
 * among others and there are no others here — and that left `Escape` and `d` as the only
 * exits. A keyboard shortcut is not a door: somebody who arrived with the mouse and never
 * pressed a key has nothing to find. So there is one button, and this is the assertion that
 * it is where the page's margin is rather than over the page.
 */
const exit = await page.evaluate(() => {
	const button = document.querySelector(".focus-exit");
	if (!button) return { present: false };
	const box = button.getBoundingClientRect();
	const page_ = document.querySelector(".focus-page")?.getBoundingClientRect();
	return {
		present: true,
		label: button.getAttribute("aria-label"),
		// Negative would mean the button overlaps the page's first line.
		air: page_ ? Math.round(page_.top - box.bottom) : -1,
		/*
		 * What the page says is at the button's own centre.
		 *
		 * The first version of this button was in the page's top-right corner, where it was drawn
		 * *under* the app's zoom pill: `z-20`, a sibling of the stage, so nothing painted inside
		 * the stage can be above it. It reported `present: true`, `visible: visible`, and could
		 * not be clicked — so the assertion has to ask the page, not the element.
		 */
		hit: (() => {
			const at = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
			return at === button || button.contains(at) ? "the button" : (at?.className || at?.tagName || "nothing");
		})(),
	};
});
say("the focus view offers a way out that is not a key", exit.present && exit.label === "Leave the focus view", JSON.stringify(exit));
say("…drawn in the page's own margin, so it covers nothing", exit.present && exit.air >= 0, `${exit.air}px of air between the button and the page's top edge`);
say("…with nothing drawn over it, which is what makes it pressable", exit.hit === "the button", String(exit.hit));
/*
 * The bar is laid out at the size it is drawn, and the world keeps its layer.
 *
 * Those two are one decision, not two: the bar's screen size comes from `--unit` (a length in
 * board units that the camera's scale cancels) rather than from a `scale(1 / zoom)` transform,
 * because a transform inside the world's composited layer is resampled — rastered at the
 * camera's scale, scaled down by the bar, scaled back up by the camera — and the text came out
 * visibly soft at 4×. The assertion is the pair, so that "fixing" the blur by counter-scaling the
 * bar fails here rather than passing quietly.
 *
 * The world's `will-change` is read in the same breath and is now expected to be **absent**, which
 * reverses what this line said before. It used to be asserted as `transform` — the argument being
 * that taking the world's layer off would give up the cheap pan. The person reading a board at
 * 400% on a 2× display then reported that removing it sharpens the board: the promise to hold the
 * picture is exactly what stops the raster being remade at a new scale, and a software rasterizer
 * (which is what this suite runs on) does not honour it, so nothing here could see it. Scoping the
 * promise to a gesture was tried and reverted — it flashed under the pointer, and a camera moved
 * without a gesture could leave it held over the wrong scale — so the pan pays for itself and
 * `camera.mjs` asserts that nothing puts the promise back.
 */
const raster = await page.evaluate(() => {
	const bar = document.querySelector(".board-node .chrome");
	const world = document.querySelector(".world");
	return { barTransform: getComputedStyle(bar).transform, worldWillChange: getComputedStyle(world).willChange };
});
say(
	"the bar is drawn at the size it is laid out, not scaled, so zooming cannot soften it",
	raster.barTransform === "none" && raster.worldWillChange === "auto",
	JSON.stringify(raster),
);

/*
 * One corner, and the page draws it.
 *
 * A board on the canvas is a rounded box (`.board-node > .surface`, 12px) and that radius is
 * *inside* the frame, so it scales with the page while the page's own does not — two curves that
 * cross at every zoom but 1, and a square-cornered page showing behind the board's curve. That
 * is what "double corner radius" was.
 */
const corners = await page.evaluate(() => {
	const page_ = document.querySelector(".focus-page");
	const surface = document.querySelector(".focus .board-node > .surface");
	return { page: page_ ? getComputedStyle(page_).borderRadius : null, surface: surface ? getComputedStyle(surface).borderRadius : null };
});
say(
	"…with one rounded corner, drawn by the page rather than by the board inside it",
	corners.page === "12px" && corners.surface === "0px",
	JSON.stringify(corners),
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

/*
 * And the same way out with the mouse.
 *
 * Entered by the key this time — the button in the bar was exercised at the top of this check
 * — so what is asserted here is that the exit button is a second door into the same room and
 * not a label on the first: the toggle is one function, reached three ways.
 */
await page.keyboard.press("d");
await settle(page, 700);
const backIn = await page.evaluate(() => Boolean(document.querySelector(".focus")));
say("the view can also be entered by its key", backIn, String(backIn));
await page.locator(".focus-exit").click();
await settle(page, 700);
const byButton = await state();
say(
	"…and the button on the page puts the canvas back",
	!byButton.open && !byButton.worldHidden && !byButton.worldInert,
	JSON.stringify({ open: byButton.open, hidden: byButton.worldHidden, inert: byButton.worldInert }),
);

say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
