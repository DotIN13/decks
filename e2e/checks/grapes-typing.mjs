/**
 * A flow document **typed into**, through GrapesJS's own canvas, and committed as ops.
 *
 * This is the half `grapes.mjs` deliberately leaves out and the design's milestone
 * (`boards/editing-a-flow-document-properly-not-as-source`): _retype a sentence in a document,
 * commit it, and one line of the file moves_. The ops are the mapper's (`block-edits.ts`) and
 * `patch.ts` is still the thing that writes — so what is asserted is the whole path, from a
 * caret in GrapesJS's canvas to one line of a file on disk.
 *
 * ### Why this is reachable now and was not before
 *
 * Two faults sat between the check and this edit, and neither was in the mapper:
 *
 * - **The canvas was not the board's page.** GrapesJS wraps the components in an anonymous
 *   `<div>`, `board.css`'s `body.board > *` made that wrapper `position: absolute`, and a
 *   `.doc` with `width: 100%` resolved against a box 0px wide. The document laid out as a
 *   64px column of wrapped words — present, invisible, and with nothing at that width to
 *   click. The editor now deletes the wrapper's box and writes the board's own size and body
 *   attributes into the canvas.
 * - **The canvas was inert.** `.board-node[data-inert="true"] .surface iframe` is what makes a
 *   drag below half zoom a pan rather than a click into somebody's page, and the editor's own
 *   canvas is a descendant of `.surface` — so an editor opened at the deck's fit could not be
 *   clicked into at all.
 *
 * The edit itself is one line, deliberately: the fixture's flow board holds its heading on a
 * single line, and a *multi-line* paragraph would move the two lines its range spans, which
 * reads as a failed check rather than as the behaviour the design promises.
 */
import { boardPath, open, read, resetStage, say, settle, write } from "../harness.mjs";

const { browser, page, errors } = await open({ width: 1440, height: 1000, edit: true });
await resetStage(page);
await settle(page, 600);

const file = await boardPath("notes.html");
const original = read(file);
const node = '.board-node[data-path="boards/notes.html"]';
const editor = () => page.evaluate(() => Boolean(document.querySelector(".grapes-editor")));

/*
 * Fly to the board, on the left end of its bar.
 *
 * Not the bar's centre: the acts group at the right-hand end holds the document button, and a
 * double-click that lands on it opens the editor — which then makes the *next* press a second
 * open rather than the first one. The left end is the title, which means "this board" and
 * nothing else.
 */
await page.locator(`${node} .chrome`).dblclick({ position: { x: 24, y: 12 } });
await settle(page, 900);

const zoom = () =>
	page.evaluate(() => Number((document.querySelector('.pill [aria-label^="Zoom"]')?.textContent ?? "0%").replace(/[^0-9.]/g, "")));
say("flying to the board puts it past the interaction threshold", (await zoom()) >= 50, `${await zoom()}%`);

const openButton = page.locator(`${node} [data-act="document"]`);
say("a flow document offers the document editor in its own bar", (await openButton.count()) === 1, "one button");
await openButton.click();

// GrapesJS is imported on demand — a megabyte of editor most sessions never open.
for (let i = 0; i < 40 && !(await editor()); i++) await settle(page, 250);
say("the editor opens", await editor(), "a .grapes-editor is on the canvas");

const canvasReady = async () => {
	for (let i = 0; i < 60; i++) {
		const ready = await page.evaluate(
			() => Boolean(document.querySelector("#decks-document-canvas")?.contentDocument?.querySelector(".doc")),
		);
		if (ready) return true;
		await settle(page, 250);
	}
	return false;
};
say("the document renders in the canvas", await canvasReady(), "one canvas with the .doc in it");

/*
 * **One editor, and it stays one.** The editor is keyed on the signal App holds, so a second
 * press on the button — which is where the cursor already is — used to build a second editor
 * from scratch, taking anything typed into the first with it. Counted over a beat rather than
 * at one instant, because a remount is exactly the thing that would hide between two reads.
 */
let editors = 0;
for (let i = 0; i < 8; i++) {
	editors = Math.max(editors, await page.evaluate(() => document.querySelectorAll(".grapes-editor").length));
	await settle(page, 250);
}
say("…and stays one editor while it is open", editors === 1, `${editors} .grapes-editor elements over 2s`);

/*
 * The retype. GrapesJS's own gesture — one click selects a component, a double-click puts the
 * caret in it — and the heading, because it is one line of the file.
 */
const frame = page.frameLocator("#decks-document-canvas");
const heading = frame.locator(".doc h1").first();
await heading.dblclick();
await settle(page, 250);
const editable = await page.evaluate(() => {
	const canvas = document.querySelector("#decks-document-canvas")?.contentDocument;
	return canvas?.querySelector("[contenteditable='true']")?.tagName ?? null;
});
say("a double-click in the canvas puts a caret in the heading", editable === "H1", String(editable));

/*
 * The retype.
 *
 * Typed at a person's pace, with a `d` in the marker, and both are the point. The app's bare
 * keys are canvas shortcuts — `d` is the focus view, `v s c t e` pick a tool — and a key pressed
 * while the caret is in the canvas arrives at the app's own handler with the **frame** as its
 * target, so the handler's "is this a text field" check cannot see the editable element in the
 * other document. A heading containing a `d` used to put the whole canvas into the focus view
 * and throw the edit away, and a marker without one passed while every heading a person would
 * actually write failed.
 *
 * The delay matters for the same reason: the editor's canvas is resized on a 200ms timer, and
 * an unguarded style write on every tick — on the element the caret is in — cost the caret at a
 * human typing pace while a single fast burst got through.
 */
await page.keyboard.press("Control+a");
await page.keyboard.type("A big round moon", { delay: 60 });
await page.keyboard.press("Meta+s");

/*
 * The write travels canvas → mapper → server → watcher, so "did it land" is a condition with
 * no fixed duration.
 */
let after = original;
for (let i = 0; i < 60 && after === original; i++) {
	await settle(page, 250);
	after = read(file);
}
say("the file changed", after !== original, `${original.length} -> ${after.length} bytes`);

const before = original.split("\n");
const now = after.split("\n");
const moved = now.filter((line, index) => line !== before[index]);
say(
	"…by exactly one line, the one the heading sits on",
	moved.length === 1 && now.length === before.length,
	`${moved.length} line(s) moved, ${before.length} -> ${now.length} lines`,
);
/*
 * The strongest form of the claim, and the one that matters to an agent holding line numbers:
 * the file is the original with one string replaced, and nothing else about it moved.
 */
say(
	"…and every other byte of the file is untouched",
	after === original.replace("<h1>What the survey round found</h1>", "<h1>A big round moon</h1>"),
	JSON.stringify(moved[0] ?? ""),
);
say(
	"…so the heading is the file's own line, not a reformatting of it",
	(moved[0] ?? "").includes("<h1>A big round moon</h1>"),
	JSON.stringify(moved[0] ?? ""),
);

/*
 * ── And a block that holds blocks ───────────────────────────────────────────────────
 *
 * The table's cells hold a `<p>`, which is what a table written by an agent looks like — and what
 * used to make typing in one impossible. The mapper addressed the *block*, so the payload was the
 * whole `<table>`, and the server refused it in the sentence a person actually saw:
 *
 *     the <table> at child 4 of #body holds blocks rather than words; edit it with the file tools
 *
 * Nothing was written and the words were gone. The fix is a descent: the walk goes into a block
 * that holds blocks and addresses the run of words inside it, five levels down — table, body,
 * row, cell, paragraph — so the write is one line and the other cells are never re-serialised.
 *
 * A cell is not editable in GrapesJS (the `cell` type has no rich-text view), which is exactly
 * why the paragraph inside it is the thing to type in: it is the only element in a table a person
 * can put a caret into at all.
 */
await openButton.click();
for (let i = 0; i < 40 && !(await editor()); i++) await settle(page, 250);
await canvasReady();

const cell = frame.locator(".doc td p", { hasText: "61%" }).first();
await cell.dblclick();
await settle(page, 250);
// The caret goes in; the words are selected here rather than typed over, so the assertion is about
// the commit and not about how a browser treats a double-click's selection.
await page.evaluate(() => {
	const canvas = document.querySelector("#decks-document-canvas")?.contentDocument;
	const paragraph = [...(canvas?.querySelectorAll(".doc td p") ?? [])].find((el) => el.textContent?.trim() === "61%");
	const range = canvas.createRange();
	range.selectNodeContents(paragraph);
	canvas.defaultView.getSelection().removeAllRanges();
	canvas.defaultView.getSelection().addRange(range);
});
await page.keyboard.type("63%");
await page.keyboard.press("Meta+s");

let celled = after;
for (let i = 0; i < 60 && celled === after; i++) {
	await settle(page, 250);
	celled = read(file);
}
/** The table row the edited cell is in, wherever the edit left it. */
const row = (text) => text.split("\n").find((line) => line.includes("<p>Illness</p>")) ?? "";
const beforeCell = after.split("\n");
const afterCell = celled.split("\n");
const movedCell = afterCell.filter((line, index) => line !== beforeCell[index]);
say(
	"typing in a cell of a table moves one line of the file",
	celled !== after && movedCell.length === 1 && afterCell.length === beforeCell.length,
	`${movedCell.length} line(s) moved, ${beforeCell.length} -> ${afterCell.length} lines`,
);
say(
	"…the cell's own line, with the other cells untouched",
	movedCell[0] === row(after).replace("<p>61%</p>", "<p>63%</p>"),
	JSON.stringify(movedCell[0]?.trim() ?? "no line moved"),
);
say(
	"…with nothing anywhere saying the table holds blocks",
	!(await page.evaluate(() => document.body.innerText)).includes("holds blocks"),
	"no refusal notice on the page",
);

say("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));

// Put the fixture back the way the next check expects it.
write(file, original);
await settle(page, 400);
await browser.close();
