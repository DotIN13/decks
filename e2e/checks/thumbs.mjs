/**
 * Photographed thumbnails: taken once, kept per revision, and only where they belong (§6.6).
 *
 * A thumbnail is the board itself, scaled down, which is why one is never stale — and why it
 * costs a live document every time you look at it. So the browse grid — the Deck tab in
 * tiles, an all-canvases modal when this was written — photographs a board once and shows
 * the photograph afterwards, keyed `path@rev` so an edit misses the cache by construction
 * rather than by anyone remembering to invalidate it.
 *
 * What has to hold, and each of these has a way of quietly not holding:
 *
 * - the picture replaces the *document*, or it is a cache that saved nothing;
 * - an edit goes back to a live document, or the deck shows you a board as it used to be;
 * - a *row* mounts no document at all, which is the panel's own cost bound;
 * - and the picture has ink in it. The snapshot copies a shortlist of style properties
 *   rather than all ~340 of them, which is 2.2× faster and the one thing that could go
 *   wrong silently: a board drawn with a property nobody listed comes out blank, and blank
 *   is exactly what a lazy thumbnail looks like anyway.
 */
import { rmSync } from "node:fs";
import { boardPath, deckState, open, openAllBoards, openPanel, read, say, settle, socket, write } from "../harness.mjs";

const EXTRA = 6;
const made = [];
for (let i = 1; i <= EXTRA; i += 1) {
	const file = await boardPath(`shot-${i}.html`);
	write(
		file,
		`<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Shot ${i}</title>
<meta name="board" content='{"w":1200,"h":800,"bg":"grid"}' /><link rel="stylesheet" href="../lib/board.css" /></head>
<body class="board">
<h1 class="text" data-id="h${i}" style="left:60px;top:48px;width:900px">Shot number ${i}</h1>
<section class="card" data-id="c${i}" style="left:60px;top:150px;width:460px"><h3>A card</h3><p>Prose and a list.</p><ul><li>one</li><li>two</li></ul></section>
<div class="sticky" data-id="s${i}" style="left:560px;top:150px;width:320px">A sticky note, for something with a colour in it.</div>
<script src="../lib/board.js"></script></body></html>`,
	);
	made.push(file);
}

const link = await socket();
const wanted = made.map((file) => `boards/${file.split("/").pop()}`);
const deadline = Date.now() + 15000;
while (Date.now() < deadline) {
	const known = (await deckState()).boards.map((board) => board.path);
	if (wanted.every((path) => known.includes(path))) break;
	await new Promise((resolve) => setTimeout(resolve, 150));
}

const { browser, page, errors } = await open({ width: 1400, height: 900 });
try {
	/** What each tile in the grid currently is: a document, a photograph, or nothing. */
	const shapes = () =>
		page.evaluate(() =>
			[...document.querySelectorAll(".panel-list .rail-item")].map((item) => ({
				path: item.dataset.path ?? "?",
				kind: item.querySelector("iframe") ? "document" : item.querySelector(".thumb-shot") ? "photograph" : "blank",
			})),
		);
	const count = async (kind) => (await shapes()).filter((entry) => entry.kind === kind).length;
	const grid = () => page.getByRole("button", { name: "Show boards as a grid" }).click();
	const rows = () => page.getByRole("button", { name: "Show boards as a list" }).click();

	// --- 1. the first look is live documents, as it always was ------------------------
	await openAllBoards(page);
	await grid();
	await page.waitForFunction(() => document.querySelectorAll(".panel-list .rail-item iframe").length > 0, null, { timeout: 15000 });
	say("the first look at a board is the board itself", (await count("document")) > 0, JSON.stringify(await shapes()));

	/*
	 * Pictures are taken on idle, after a settle, one at a time — so this waits on the
	 * outcome rather than on a duration. A deck of nine boards is a few seconds of that.
	 */
	await page.waitForFunction(() => document.querySelectorAll(".panel-list .thumb-shot").length > 0, null, { timeout: 30000 });
	await settle(page, 3000);
	const photographed = await count("photograph");
	say("and then it is photographed", photographed > 0, `${photographed} of ${(await shapes()).length}`);

	// --- 2. the picture replaces the document ----------------------------------------
	/*
	 * Asserted on coming back rather than in place. While the grid is up a board that has
	 * been photographed swaps to its picture, but the *point* of the cache is the second
	 * look: leaving the tab and returning is what used to rebuild every document.
	 */
	await openPanel(page, "context");
	await settle(page, 400);
	await openPanel(page, "deck");
	await settle(page, 1200);
	const second = await shapes();
	const docs = second.filter((entry) => entry.kind === "document").length;
	say(
		"reopening it costs no documents for the boards already photographed",
		second.filter((entry) => entry.kind === "photograph").length >= photographed,
		JSON.stringify(second.map((entry) => entry.kind)),
	);
	say("…and the ones left as documents are the ones with no picture yet", docs < second.length, `${docs} still live`);

	// --- 3. the picture has ink in it -------------------------------------------------
	/*
	 * The shortlist of copied style properties is the risk this guards. A board that came out
	 * blank would look exactly like a thumbnail that has not loaded, so it is measured: the
	 * fraction of pixels that differ from the corner pixel, which is the background.
	 */
	/*
	 * One of *this check's* boards, named — not whichever tile sorts first.
	 *
	 * The size assertion is exact (300×200 for a 1200×800 board, since the scale is
	 * `WIDTH / board.w`), so it only means anything about a board whose dimensions this file
	 * chose. Reading the first `.thumb-shot` in the grid read the fixture deck's own
	 * `plan.html` at 1200×840 and failed with `300x210` — a true measurement of the wrong
	 * board.
	 */
	await page.waitForFunction((path) => Boolean(document.querySelector(`.panel-list .rail-item[data-path="${path}"] .thumb-shot`)), wanted[0], {
		timeout: 30000,
	});
	const ink = await page.evaluate(async (path) => {
		const img = document.querySelector(`.panel-list .rail-item[data-path="${path}"] .thumb-shot`);
		if (!img) return null;
		await img.decode();
		const canvas = document.createElement("canvas");
		canvas.width = img.naturalWidth;
		canvas.height = img.naturalHeight;
		const context = canvas.getContext("2d");
		context.drawImage(img, 0, 0);
		const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
		const at = (i) => [data[i], data[i + 1], data[i + 2]];
		const background = at(0);
		let different = 0;
		for (let i = 0; i < data.length; i += 4) {
			const [r, g, b] = at(i);
			if (Math.abs(r - background[0]) + Math.abs(g - background[1]) + Math.abs(b - background[2]) > 24) different += 1;
		}
		return { size: `${canvas.width}x${canvas.height}`, inked: Math.round((different / (data.length / 4)) * 100) };
	}, wanted[0]);
	say("the picture is drawn at a useful size", ink !== null && ink.size === "300x200", JSON.stringify(ink));
	say(
		"…and has the board in it rather than a blank rectangle",
		ink !== null && ink.inked > 3 && ink.inked < 97,
		`${ink?.inked}% of pixels differ from the background`,
	);

	// --- 4. an edit goes back to a live document -------------------------------------
	/*
	 * The freshness property, which is the whole reason there is no thumbnail service. The
	 * key is `path@rev`, so this needs no invalidation to work — a new revision is a key
	 * nobody has a picture for.
	 */
	/*
	 * One of this check's own boards again, and for a sharper reason than section 3's: the
	 * edit below is `read` then `replace("A sticky note", …)`. On a board that does not
	 * contain that string the write is a no-op, the revision never changes, and the wait for
	 * a live document is a guaranteed 20-second timeout that reads as a caching bug.
	 */
	const target = second.find((entry) => entry.kind === "photograph" && wanted.includes(entry.path))?.path;
	say("a photographed board to edit", Boolean(target), String(target));
	const file = await boardPath(target.split("/").pop());
	write(file, read(file).replace("A sticky note", "An edited sticky note"));
	await page.waitForFunction(
		(path) => {
			const item = document.querySelector(`.panel-list .rail-item[data-path="${path}"]`);
			return Boolean(item?.querySelector("iframe"));
		},
		target,
		{ timeout: 20000 },
	);
	say("editing a board sends its thumbnail back to the live board", true, `${target} is a document again`);

	// --- 5. a row costs nothing --------------------------------------------------------
	/*
	 * This used to read the other way round: *the context panel keeps live documents and is
	 * never photographed*, because those are the boards an agent is rewriting and a picture
	 * of one would be out of date before it landed.
	 *
	 * Both halves of that are settled elsewhere now. Freshness is the `path@rev` key, which
	 * section 4 proves — an edit misses the cache whoever is holding the board — so a
	 * photograph is no longer a claim that the board has stopped changing. And a row is 28px
	 * with a 20×14 picture beside the name: there is nowhere to put a document, and mounting
	 * one to fill fourteen pixels was the cost this panel was rebuilt to stop paying. So what
	 * is asserted is the bound rather than the medium: **no row mounts a document**, however
	 * many boards the agent holds.
	 */
	for (const path of wanted.slice(0, 3)) link.send({ type: "board.play", path });
	await rows();
	await openPanel(page, "context");
	await page.waitForFunction(() => document.querySelectorAll(".panel-list .board-row").length >= 3, null, { timeout: 15000 });
	await settle(page, 4000);
	const panel = await page.evaluate(() => ({
		rows: document.querySelectorAll(".panel-list .board-row").length,
		documents: document.querySelectorAll(".panel-list iframe").length,
		pictures: document.querySelectorAll(".panel-list .board-thumb img").length,
	}));
	say("a context row mounts no document", panel.documents === 0, JSON.stringify(panel));
	say("…and shows the picture it already has", panel.pictures > 0, JSON.stringify(panel));

	say("no page errors", errors.length === 0, errors.join(" | "));
} finally {
	for (const file of made) rmSync(file, { force: true });
	link.close();
	await page.waitForTimeout(600);
	await browser.close();
}
