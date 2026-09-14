/**
 * Reordering a block in a flow document — the drag, and the one line that moves.
 *
 * The editor could type and could not rearrange: `diffBlocks` read any change of relative order
 * as something the op set could not describe and offered the source textarea, so dragging a
 * paragraph past another was refused. `move-child` was built and tested on the server all along
 * (`boards/patch.ts`), so what this checks is the whole path — pointer down on a block, dragged
 * to a new place, committed — and the *one* op that comes out of it.
 *
 * It goes there and back. Down is the direction a left-to-right pass gets wrong (it moves the
 * blocks above the dragged one instead), and coming back is the strongest assertion available:
 * a reorder there and back has to leave the file **byte for byte** as it was.
 */
import { boardPath, open, read, resetStage, say, settle, write } from "../harness.mjs";

const { browser, page, errors } = await open({ width: 1440, height: 1000, edit: true });
await resetStage(page);
await settle(page, 600);

const file = await boardPath("notes.html");
const original = read(file);
const node = '.board-node[data-path="boards/notes.html"]';
const frame = () => page.frameLocator("#decks-document-canvas");

/* Fly to the board on the left end of its bar — the acts at the right hold the document button. */
await page.locator(`${node} .chrome`).dblclick({ position: { x: 24, y: 12 } });
await settle(page, 900);

const editor = () => page.evaluate(() => Boolean(document.querySelector(".grapes-editor")));
const openEditor = async () => {
	await page.locator(`${node} [data-act="document"]`).click();
	for (let i = 0; i < 40 && !(await editor()); i++) await settle(page, 250);
	for (let i = 0; i < 60; i++) {
		const ready = await page.evaluate(
			() => Boolean(document.querySelector("#decks-document-canvas")?.contentDocument?.querySelector(".doc > *")),
		);
		if (ready) break;
		await settle(page, 250);
	}
};

/** The tag names of the document's blocks, as the canvas is drawing them right now. */
const order = () =>
	page.evaluate(() => {
		const canvas = document.querySelector("#decks-document-canvas")?.contentDocument;
		return [...(canvas?.querySelectorAll(".doc > *") ?? [])].map((element) => element.tagName).join(",");
	});

/**
 * Drag the block at `from` to just past `to`.
 *
 * GrapesJS's sorter starts on a press and a few pixels of movement, and decides where to drop
 * from where the pointer is — so the second move lands on a block boundary rather than inside a
 * paragraph. The commit is the caller's: what the canvas looks like has to be read before the
 * editor closes.
 */
const drag = async (from, to, drop) => {
	const a = await frame().locator(`.doc > *:nth-child(${from})`).boundingBox();
	const b = await frame().locator(`.doc > *:nth-child(${to})`).boundingBox();
	await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
	await page.mouse.down();
	await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + 24, { steps: 8 });
	await page.mouse.move(b.x + b.width / 2, drop === "after" ? b.y + b.height + 6 : b.y - 6, { steps: 16 });
	await settle(page, 200);
	await page.mouse.up();
	await settle(page, 300);
	return await order();
};

const settled = async (was) => {
	for (let i = 0; i < 60; i++) {
		await settle(page, 250);
		const text = read(file);
		if (text !== was) return text;
	}
	return read(file);
};

await openEditor();
say("the editor is open on the canvas", await editor(), "a .grapes-editor is on the canvas");

/*
 * 1. The heading, dragged to the bottom of the document.
 *
 * The drop lands below the last block's bottom edge, which is past the last of them — and it is
 * the direction that matters, because the file has to grow a line at the bottom and lose one at
 * the top.
 */
const dragged = await drag(1, 7, "after");
say("the drag put the heading last in the canvas", dragged.endsWith("H1"), dragged);
await page.keyboard.press("Meta+s");

let after = await settled(original);
say("the commit wrote the file", after !== original, `${original.length} -> ${after.length} bytes`);

const lines = (text) => text.split("\n");
const at = (list) => list.findIndex((line) => line.includes("<h1>"));
const without = (list) => list.filter((line) => !line.includes("<h1>")).join("\n");
say(
	"…moving the heading's own line down, and no line was added or lost",
	at(lines(after)) > at(lines(original)) && lines(after).length === lines(original).length,
	`h1 at line ${at(lines(original))} → ${at(lines(after))}, ${lines(original).length} → ${lines(after).length} lines`,
);
say(
	"…and the file without the heading's line is the same bytes",
	without(lines(original)) === without(lines(after)),
	"one line moved; nothing was reformatted on the way",
);

/*
 * 2. And back to the top.
 *
 * The assertion is the whole file: if a reorder there and back does not come out byte for byte,
 * then something in the round trip re-serialised, re-indented or shifted a byte that nobody
 * asked about.
 */
await openEditor();
const back = await drag(7, 1, "before");
say("the drag put the heading first again", back.startsWith("H1"), back);
await page.keyboard.press("Meta+s");
after = await settled(after);
say("…and the file is back to the byte", after === original, `${after.length} bytes vs ${original.length}`);

say("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));

// Put the fixture back the way the next check expects it.
write(file, original);
await settle(page, 400);
await browser.close();
