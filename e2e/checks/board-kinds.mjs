/**
 * Three board formats: a component board, a flow board, and a deck.
 *
 * The formats themselves are unit-tested (`deck/kinds.ts`, `boards/shell.ts`,
 * `boards/slides.test.ts`, `canvas/slide-keys.ts`). What a browser is needed for is whether
 * they are *wired*: whether a markdown file dropped into `boards/` becomes a board, whether
 * it ends up exactly as tall as its content, whether ← → page a focused deck, whether
 * fullscreen opens on the slide you were on, and whether a double-click gives you the file.
 *
 * The interesting assertions are the ones a unit test cannot make, because they are about
 * two processes agreeing: the browser measures a height and the server stores it; a
 * keystroke lands in an iframe and moves a slide in it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { deckState, open, say, settle } from "../harness.mjs";

const deckDir = (await deckState()).path;
const boards = join(deckDir, "boards");

writeFileSync(
	join(boards, "notes.md"),
	`---
w: 760
---

# Session notes

A markdown file **is** a board. The height is measured, never stored.

- one
- two
- three

$e^{i\\pi} + 1 = 0$
`,
);
writeFileSync(
	join(boards, "report.html"),
	`<!doctype html><html><head><title>A plain document</title></head>
<body><h1>A plain document</h1><p>No class="board", so this is flow.</p></body></html>`,
);
writeFileSync(
	join(boards, "talk.slides.md"),
	`---
title: A deck
aspect: "16:9"
---

# One
The first slide.

---

# Two
The second.

Note: hidden until a presenter view exists.

---

# Three

---

# Four
The last one.
`,
);

const { browser, page, errors } = await open({ width: 1500, height: 950 });
await settle(page, 2500);

const deck = async () => (await deckState()).boards;
const boardOf = async (path) => (await deck()).find((board) => board.path === path);

// --- the formats reach the browser ---------------------------------------------------

const found = await deck();
say(
	"a markdown file dropped into boards/ is a board",
	found.some((board) => board.path === "boards/notes.md" && board.format === "flow"),
	JSON.stringify(found.map((board) => `${board.format}:${board.path.replace("boards/", "")}`)),
);
say("…an HTML file without class=board is flow", (await boardOf("boards/report.html"))?.format === "flow");
say("…a .slides.md is a deck", (await boardOf("boards/talk.slides.md"))?.format === "slides");
say("…and the boards that were already here are untouched", (await boardOf("boards/plan.html"))?.format === "component");

// The title comes from the content, because a rail full of filenames says nothing.
say("a flow board is named by its content", (await boardOf("boards/notes.md"))?.title === "Session notes");
say("…and a deck by its front-matter", (await boardOf("boards/talk.slides.md"))?.title === "A deck");

// --- a flow board is as tall as its content ------------------------------------------

/*
 * The round trip: the frame measures, the server stores, the deck reports it back. The
 * placeholder is 240, so any real content proves the measurement travelled rather than the
 * default surviving.
 */
/*
 * One board on the canvas at a time, played the way a person does it.
 *
 * Clearing first is what makes the rest of this reliable: `show` fits the camera to
 * everything in play, so a canvas of six boards leaves each one small and possibly
 * off-screen — and a click at a coordinate then lands on the background. Playing a board
 * also *selects* it, which is the state the arrow keys depend on.
 */
const only = async (title) => {
	await page.locator('button[aria-label="Clear the canvas"]').click();
	await settle(page, 800);
	// The row carries the board's title; a dimmed row appends "— held, not on the canvas",
	// so the prefix is the reliable part.
	await page.locator(`button.board-row[title^="${title}"]`).first().click();
	await settle(page, 3000);
};
await only("Session notes");
const notes = await boardOf("boards/notes.md");
say("a flow board takes the height its content measured", notes && notes.h > 240 && notes.h < 900, `${notes?.w}x${notes?.h}`);
say("…and keeps the width its front-matter asked for", notes?.w === 760, String(notes?.w));

// --- the deck ------------------------------------------------------------------------

await only("A deck");

const inDeck = (fn) =>
	page.evaluate((body) => {
		const frame = document.querySelector('.board-node[data-path="boards/talk.slides.md"] iframe');
		// eslint-disable-next-line no-new-func
		return new Function("w", "d", body)(frame?.contentWindow, frame?.contentDocument);
	}, `return (${fn.toString()})(w, d);`);

const at = () => inDeck((w) => w?.__deck?.current?.() ?? null);
const count = () => inDeck((_w, d) => d?.querySelector(".deck-count")?.textContent ?? null);

say("a deck opens on its first slide", (await at()) === 0 && (await count()) === "1 / 4", JSON.stringify(await count()));
say(
	"…laid out at 960 logical pixels and scaled, never reflowed",
	await inDeck((_w, d) => d?.querySelector(".slide")?.getBoundingClientRect().width === 960),
);
/*
 * The note is on slide two, and slides render lazily — a deck of forty should not render
 * forty on open — so it does not exist until you have been there. Which is itself worth
 * asserting: it is the behaviour that keeps a canvas of decks cheap.
 */
say("a slide is rendered when it is reached, not all at open", (await inDeck((_w, d) => d?.querySelectorAll(".deck-stage .slide").length)) === 1);

// --- ← → , which is the point ---------------------------------------------------------

/*
 * Focus is the ask, and the rule is "the *selected* board takes the arrows" — so the state
 * that matters is a deck on the canvas while you are working on something else. Playing a
 * board selects it, so this selects a different board first.
 */
/*
 * Clicking the canvas background deselects, which is the state the rule is about: a deck
 * sitting on the canvas that you are not working on must not swallow the arrow keys.
 *
 * Deselecting rather than selecting another board, and that is not a shortcut — playing a
 * second board refits the camera, which can unmount the deck's frame entirely, and a test
 * that passes because the thing it is testing is gone tests nothing.
 */
await page.locator(".stage").click({ position: { x: 8, y: 8 } });
await settle(page, 500);
say("clicking the background deselects", (await page.locator('.board-node[data-selected="true"]').count()) === 0);
await page.keyboard.press("ArrowRight");
await settle(page, 400);
say("…and a deck you are not working on ignores the arrows", (await at()) === 0, `slide ${await at()}`);

/*
 * Click the deck itself, which is how a person focuses one — and the case the wiring is
 * really about: clicking a board puts the caret **inside its iframe**, so the keystroke that
 * follows never reaches the app's own window. It arrives in the board's document and is
 * handed back out by `frame-gestures.ts`. Selecting from the rail would leave the focus in
 * the top document and quietly test the easier path.
 */
await page.locator('.board-node[data-path="boards/talk.slides.md"] iframe').click({ position: { x: 300, y: 200 } });
await settle(page, 800);
say("clicking a deck puts the focus inside its frame", await page.evaluate(() => document.activeElement?.tagName === "IFRAME"));
await page.keyboard.press("ArrowRight");
await settle(page, 500);
say("→ pages a focused deck", (await at()) === 1, `slide ${await at()}`);
say(
	"…and the slide it moved to is rendered now",
	(await inDeck((_w, d) => d?.querySelectorAll(".deck-stage .slide").length)) === 2,
);
say("a speaker note is kept and not drawn", await inDeck((_w, d) => {
	const note = d?.querySelector(".slide-note");
	return Boolean(note && note.textContent.includes("presenter view") && note.offsetHeight === 0);
}));
await page.keyboard.press("ArrowRight");
await page.keyboard.press("ArrowLeft");
await settle(page, 500);
say("…and ← goes back", (await at()) === 1, `slide ${await at()}`);
await page.keyboard.press("End");
await settle(page, 400);
say("End is the last slide", (await at()) === 3 && (await count()) === "4 / 4");
// A presenter's clicker sends these two and nothing else.
await page.keyboard.press("PageUp");
await settle(page, 400);
say("a clicker's PageUp works", (await at()) === 2, `slide ${await at()}`);
await page.keyboard.press("Home");
await settle(page, 400);
say("Home is the first", (await at()) === 0);

// --- fullscreen -----------------------------------------------------------------------

await page.keyboard.press("ArrowRight");
await page.keyboard.press("ArrowRight");
await settle(page, 500);
say("parked on slide 3 before presenting", (await at()) === 2, `slide ${await at()}`);

await page.keyboard.press("f");
await settle(page, 2500);
say("f opens the overlay", (await page.locator(".present").count()) === 1);
const inOverlay = (fn) =>
	page.evaluate((body) => {
		const frame = document.querySelector(".present-frame");
		// eslint-disable-next-line no-new-func
		return new Function("w", "d", body)(frame?.contentWindow, frame?.contentDocument);
	}, `return (${fn.toString()})(w, d);`);
say(
	"…on the slide you were on, not back at the start",
	(await inOverlay((w) => w?.__deck?.current?.() ?? null)) === 2,
	`slide ${await inOverlay((w) => w?.__deck?.current?.() ?? null)}`,
);
say("…and the counter agrees", (await page.locator(".present-count").textContent()).trim() === "3 / 4");

/*
 * And the slide is scaled to the overlay, not left at the board's own 960.
 *
 * The same document serves the canvas and fullscreen — which is what makes the slide
 * identical in both — but a board document lays out at the board's width, so a 960-wide
 * deck sat in the corner of a 1500px overlay until `?present=1` existed. Measured as the
 * *painted* width, because the element is still 960 logical pixels: the scale is the whole
 * mechanism, so a test of the layout box would pass while the slide stayed small.
 */
const painted = await inOverlay((_w, d) => {
	const slide = d?.querySelector(".deck-stage .slide:not([hidden])");
	return slide ? Math.round(slide.getBoundingClientRect().width) : 0;
});
const frameWide = Math.round((await page.locator(".present-frame").boundingBox()).width);
say("…and the slide is scaled to fill the overlay", Math.abs(painted - frameWide) <= 4, `slide ${painted}px in a ${frameWide}px frame`);
say("…while still being 960 logical pixels underneath", (await inOverlay((_w, d) => d?.querySelector(".slide")?.offsetWidth)) === 960);

// Space is the fullscreen-only key: on the canvas it is held-to-pan.
await page.keyboard.press("Space");
await settle(page, 500);
say("Space advances a presentation", (await inOverlay((w) => w?.__deck?.current?.() ?? null)) === 3);

await page.keyboard.press("Escape");
await settle(page, 800);
say("Escape leaves", (await page.locator(".present").count()) === 0);
say("…and the canvas follows to where the talk ended", (await at()) === 3, `slide ${await at()}`);

// --- the contact sheet ----------------------------------------------------------------

/*
 * Below half zoom a board takes no pointer events, so a deck down there cannot be paged —
 * showing one slide of four would be the least useful thing. The threshold is the canvas's
 * own rather than a second number (`deckMode`).
 */
await only("A deck");
const zoomTo = async (below) => {
	for (let step = 0; step < 12; step++) {
		const percent = Number((await page.locator('.pill [aria-label^="Zoom"]').textContent()).replace("%", ""));
		if (below ? percent < 50 : percent >= 50) return percent;
		await page.keyboard.press(below ? "Control+Minus" : "Control+Equal");
		await settle(page, 250);
	}
	return null;
};
const small = await zoomTo(true);
await settle(page, 1200);
say("zoomed out past half, a deck becomes a contact sheet", (await inDeck((_w, d) => d?.querySelectorAll(".sheet-cell").length)) === 4, `at ${small}%`);
say("…and the slide view is put away", await inDeck((_w, d) => d?.querySelector(".deck-stage")?.hidden === true));
say(
	"…with the slide you were on marked",
	await inDeck((_w, d) => [...(d?.querySelectorAll(".sheet-cell") ?? [])].filter((cell) => cell.dataset.on === "true").length === 1),
);
const big = await zoomTo(false);
await settle(page, 1200);
say("zoomed back in, it is one slide again", await inDeck((_w, d) => d?.querySelector(".deck-sheet")?.hidden === true), `at ${big}%`);

// --- the source editor ----------------------------------------------------------------

await only("Session notes");
await page.locator('.board-node[data-path="boards/notes.md"] iframe').dblclick({ position: { x: 120, y: 40 } });
await settle(page, 1200);
say("a double-click opens a flow board as its own source", (await page.locator(".source-area").count()) === 1);
const shown = await page.locator(".source-area").inputValue();
say("…the actual file, front-matter and all", shown.includes("w: 760") && shown.includes("# Session notes"), `${shown.length} bytes`);
/*
 * And scrolled to the top. It opened 51px down — the first two lines of the file above the
 * fold — because focusing a textarea scrolls to the caret before the browser has settled
 * where that is. An editor that opens in the middle of your file is the sort of thing that
 * reads as data loss for a second.
 */
say("…from the top of it", (await page.locator(".source-area").evaluate((el) => el.scrollTop)) === 0);

// Escape must abandon, which is the one thing a person has to be able to rely on.
await page.keyboard.press("Escape");
await settle(page, 600);
say("Escape abandons the edit", (await page.locator(".source-area").count()) === 0);
say("…and writes nothing", readFileSync(join(boards, "notes.md"), "utf8").includes("# Session notes"));

await page.locator('.board-node[data-path="boards/notes.md"] iframe').dblclick({ position: { x: 200, y: 60 } });
await settle(page, 1000);
await page.locator(".source-area").fill("---\nw: 760\n---\n\n# Retyped by hand\n\nOne line.\n");
await page.keyboard.press("Control+s");
await settle(page, 2500);
const written = readFileSync(join(boards, "notes.md"), "utf8");
say("⌘S writes the file, exactly as typed", written === "---\nw: 760\n---\n\n# Retyped by hand\n\nOne line.\n", JSON.stringify(written.slice(0, 40)));
say("…and the board is renamed by its new heading", (await boardOf("boards/notes.md"))?.title === "Retyped by hand");
say(
	"…and it shrank to the shorter content",
	((await boardOf("boards/notes.md"))?.h ?? 999) < (notes?.h ?? 0),
	`${notes?.h} → ${(await boardOf("boards/notes.md"))?.h}`,
);

/*
 * And a component board still has its own editor. This is the regression that would matter
 * most: 290 boards in the author's own deck are component boards, and a double-click that
 * started replacing them with a textarea would be unrecoverable.
 */
await only("Auth refresh — the plan");
await page.locator('.board-node[data-path="boards/plan.html"] iframe').dblclick({ position: { x: 60, y: 60 } });
await settle(page, 900);
say("a component board does not get the source editor", (await page.locator(".source-area").count()) === 0);

say("no console errors", errors.length === 0, errors.join(" | "));
await browser.close();
void dirname;
