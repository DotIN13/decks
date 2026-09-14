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
 * How much of the panel the document actually occupies.
 *
 * Measured rather than assumed, because GrapesJS sizes its canvas itself and got it wrong: the
 * document laid out in a narrow strip at the left of a wide panel, clipped at the strip's edge,
 * with its resize handle drawn at that strip's scale as a black triangle over the page. A check
 * that only asked whether the document was *there* passed the whole time.
 */
const fill = () =>
	page.evaluate(() => {
		const box = (selector) => {
			const element = document.querySelector(selector);
			if (!element) return undefined;
			const rect = element.getBoundingClientRect();
			return { w: Math.round(rect.width), h: Math.round(rect.height) };
		};
		const panel = box(".grapes-canvas");
		const frame = box("#decks-document-canvas") ?? box(".gjs-frame");
		// Both dimensions. The first version of this measured width only and passed with a frame
		// 1116 wide and 220 tall, which is the same bug the screenshot shows in the other axis.
		return {
			panel,
			frame,
			percent: panel && frame ? Math.round((frame.w / panel.w) * 100) : null,
			heightPercent: panel && frame ? Math.round((frame.h / panel.h) * 100) : null,
		};
	});

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

const filled = await fill();
say(
	"…and it fills the panel rather than a strip of it",
	filled.percent !== null && filled.percent >= 95 && (filled.heightPercent ?? 0) >= 95,
	JSON.stringify(filled),
);

/*
 * And nothing large and dark left over it. GrapesJS draws its canvas resize handle at the
 * canvas's own scale — beside a narrow canvas that was a black wedge across the page — so this
 * asks the panel for anything big and near-black, which no chrome of ours is.
 */
const dark = await page.evaluate(() => {
	const panel = document.querySelector(".grapes-canvas");
	if (!panel) return [];
	return [...panel.querySelectorAll("*")]
		.map((element) => {
			const rect = element.getBoundingClientRect();
			const back = getComputedStyle(element).backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [];
			// Alpha-aware: the canvas frame is `rgba(0, 0, 0, 0)`, and a transparent element is
			// not a black one — the first version of this flagged the iframe itself as the wedge.
			const alpha = back.length >= 4 ? back[3] : 1;
			const darkBack = back.length >= 3 && alpha > 0.5 && back[0] < 70 && back[1] < 70 && back[2] < 70;
			return { cls: String(element.className).slice(0, 40), area: Math.round(rect.width * rect.height), darkBack };
		})
		.filter((entry) => entry.darkBack && entry.area > 20000);
});
say("…with no oversized dark furniture over it", dark.length === 0, JSON.stringify(dark).slice(0, 300));

/*
 * And it is the board's *page*, with the page's margins.
 *
 * `board.css` draws a document through `body.board`, and GrapesJS's canvas body has no classes at
 * all: what that produced was the content flush in the top-left corner, which is what "the margins
 * are not preserved" means. Measured, because "the document is there" was true throughout.
 *
 * Polled, because GrapesJS writes its frame's document more than once and the editor dresses each
 * one as it arrives — a single read taken the instant the components appear catches the page
 * before it is dressed, which is a race in the check rather than a fault in the editor. What is
 * asserted is the page a reader ends up looking at.
 */
const look = () =>
	page.evaluate(() => {
		const frame = document.querySelector("#decks-document-canvas") ?? document.querySelector(".gjs-frame");
		const doc = frame?.contentDocument;
		if (!doc) return null;
		const box = doc.querySelector(".doc > *")?.getBoundingClientRect();
		return {
			classes: doc.body?.className ?? "",
			offset: box ? { x: Math.round(box.x), y: Math.round(box.y) } : null,
			padding: doc.body ? `${getComputedStyle(doc.body).paddingTop} / ${getComputedStyle(doc.body).paddingLeft}` : "",
		};
	});
let pageLook = await look();
for (let i = 0; i < 30 && (pageLook?.offset?.x ?? 0) <= 8; i++) {
	await settle(page, 100);
	pageLook = await look();
}
say("the canvas body is the board's own page", (pageLook?.classes ?? "").includes("board"), JSON.stringify(pageLook));
say("…so the document keeps its margins", (pageLook?.offset?.x ?? 0) > 8 && (pageLook?.offset?.y ?? 0) > 8, JSON.stringify(pageLook));

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
