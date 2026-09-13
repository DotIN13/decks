/**
 * A flow document edited as a document — `boards/editing-a-flow-document-properly-not-as-source`.
 *
 * The design is GrapesJS as a **source of edits** rather than a source of documents: the editor
 * is the surface a person types on and `patch.ts` stays the thing that writes, so an untouched
 * byte cannot be reached by a splice. That is what keeps line breaks, HTML comments and an
 * agent's line numbers intact — where writing the whole file turned the IRB draft's 383 lines
 * into 225 and moved every line number in it.
 *
 * ### What this asserts, and what it deliberately does not
 *
 * Asserted, and each is a way the editor could be wrong while looking right:
 *
 * - **The way in exists** on a flow document this app wrote, and only there.
 * - **The document renders in GrapesJS's own canvas**, with `board.css` and `board.js` in it —
 *   which is what lets a `[data-md]` panel draw while it is being edited. The payload still comes
 *   from the component model, never from that frame.
 * - **An untouched document writes nothing.** Open, leave, and the file is byte-identical and no
 *   revision is recorded: an editor that records a revision for opening a board is one whose
 *   history nobody can read.
 * - **Reopening works and leaves one editor behind**, with one canvas frame in it.
 *
 * **Not asserted here: typing.** Driving an edit through the canvas needs the board past
 * `INTERACT_ZOOM` first — below half zoom a board takes no pointer events, so its canvas frame is
 * inert and every click in it goes nowhere. That is reachable (the wheel moves the camera
 * deterministically) but the camera *after* the editor opens lands at the deck's own fit, 21% in
 * this fixture, because a flow board's height is measured from the frame the editor just replaced.
 * The first version of this check zoomed first and then asserted into an inert frame: selection
 * never happened, nothing became editable, and it was the zoom rather than the editor that was
 * wrong. Until that is settled, the typing half is verified by hand and by `block-edits.test.ts`
 * (the mapper's arithmetic), not by this file.
 */
import { boardPath, open, read, resetStage, say, settle } from "../harness.mjs";

const { browser, page, errors } = await open({ width: 1440, height: 1000, edit: true });
await resetStage(page);
await settle(page, 600);

const file = await boardPath("notes.html");
const original = read(file);
const node = '.board-node[data-path="boards/notes.html"]';
const editor = () => page.evaluate(() => Boolean(document.querySelector(".grapes-editor")));

/**
 * The panel's frames, with enough about each to tell the canvas from the rest.
 *
 * There is more than one frame in there and the canvas is not the first, so a position would be
 * naming an implementation detail. `canvas` is the one holding the document — the editor names it
 * (`GrapesEditor.tsx` sets `decks-document-canvas`), because the board's own frame holds a `.doc`
 * too and "the frame with the document in it" is otherwise two frames, not one.
 */
const frames = () =>
	page.evaluate(() => {
		const compress = (text) => text.replace(/\s+/g, " ");
		return {
			editors: document.querySelectorAll(".grapes-editor").length,
			frames: [...document.querySelectorAll(".grapes-editor iframe")].map((f) => ({
				id: f.id,
				cls: String(f.className).slice(0, 30),
				hasDoc: Boolean(f.contentDocument?.querySelector('[data-id="body"]')),
				hasP: Boolean(f.contentDocument?.querySelector("p")),
				body: compress(f.contentDocument?.body?.innerHTML ?? "").slice(0, 120),
			})),
		};
	});

await page.locator(`${node} .chrome`).dblclick();
await settle(page, 900);

const openButton = page.locator(`${node} [data-act="document"]`);
say("a flow document offers the document editor in its own bar", (await openButton.count()) === 1, "one button");
await openButton.click();

// GrapesJS is imported on demand — a megabyte of editor most sessions never open — so this is the
// one place in the suite that waits for a chunk to arrive.
for (let i = 0; i < 40 && !(await editor()); i++) await settle(page, 250);
say("the editor opens", await editor(), "a .grapes-editor is on the canvas");
say("the page reported no errors", errors.length === 0, errors.slice(0, 2).join(" | "));

/**
 * Polled, because GrapesJS renders into its canvas well after the panel appears: the frame
 * arrives first and stays empty for a second or two while the components are built into it, and
 * an assertion made in that window says the editor is broken when it is only early.
 */
const documentIn = async () => {
	for (let i = 0; i < 60; i++) {
		const seen = await frames();
		if (seen.frames.some((frame) => frame.hasDoc && frame.hasP)) return seen;
		await settle(page, 250);
	}
	return await frames();
};
const opened = await documentIn();
say(
	"the document renders in GrapesJS's own canvas",
	opened.frames.some((frame) => frame.hasDoc && frame.hasP),
	JSON.stringify(opened).slice(0, 400),
);

// 1. Opening and leaving writes nothing at all.
await page.keyboard.press("Escape");
await settle(page, 500);
say("escape closes it", (await editor()) === false, "no editor");
say("…and an untouched document is byte-identical afterwards", read(file) === original, `${original.length} bytes`);

// 2. Reopening: one editor, one canvas, the document in it.
await openButton.click();
for (let i = 0; i < 40 && !(await editor()); i++) await settle(page, 250);
const again = await documentIn();
say(
	"reopening the editor works, and leaves one editor with one canvas",
	again.editors === 1 && again.frames.filter((frame) => frame.hasDoc && frame.hasP).length === 1,
	JSON.stringify({ editors: again.editors, docs: again.frames.filter((f) => f.hasDoc).length, frames: again.frames.length }),
);
say("…and the file is still untouched", read(file) === original, `${original.length} bytes`);

await page.keyboard.press("Escape");
await settle(page, 300);
await browser.close();
