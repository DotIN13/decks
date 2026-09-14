/**
 * A flow document, edited as fields rather than as its own source.
 *
 * A flow board's DOM tree *is* the file's tree — that is the condition the field editor
 * needs, and the reason it runs here at all: the patch ops that retype a run address it by
 * component id plus element-child indices and splice the bytes, leaving every byte nobody
 * touched alone. A markdown board is the case where that argument fails, because what is on
 * screen was drawn from words that are not in the file, and it keeps the source editor.
 *
 * So the assertions are the ones that matter for an edit anywhere in this app: **one line of
 * the file moved**, the rest of it byte-identical, and the frame was not reloaded to show
 * what the editor had already drawn. Plus the half that must *not* run: a document has no
 * grid, no box to resize and nowhere to place a component, so the geometry half is off.
 */
import { boardPath, open, read, resetStage, say, settle, write } from "../harness.mjs";

const { browser, page, errors } = await open({ width: 1440, height: 1000, edit: true });
await resetStage(page);
await settle(page, 600);

const file = await boardPath("notes.html");
const original = read(file);
const frame = () => page.frameLocator('.board-node[data-path="boards/notes.html"] iframe');
const sourceEditor = () => page.evaluate(() => Boolean(document.querySelector(".source-editor")));

// Fly to it, then zoom in past `INTERACT_ZOOM`: below half zoom a board takes no pointer
// events at all, so every assertion here would pass for the wrong reason.
/*
 * Fly to the board on the left end of its bar.
 *
 * Not the bar's centre: the acts at the right-hand end hold the button that opens the document
 * editor, and a double-click that lands on it opens that editor instead of flying to the board
 * — after which the board's own frame is gone and the run of words this check is about is in a
 * different document.
 */
await page.locator('.board-node[data-path="boards/notes.html"] .chrome').dblclick({ position: { x: 24, y: 12 } });
await settle(page, 900);
for (let i = 0; i < 6; i++) {
	const level = await page.evaluate(() =>
		Number((document.querySelector('.pill [aria-label^="Zoom"]')?.textContent ?? "0%").replace(/[^0-9.]/g, "")),
	);
	if (level >= 70 && level <= 200) break;
	await page.keyboard.press(level < 70 ? "Control+Equal" : "Control+Minus");
	await settle(page, 250);
}

/*
 * 1. The words, not the file.
 */
const paragraph = frame().locator(".doc p").first();
await paragraph.dblclick();
await settle(page, 300);
const opened = await page.evaluate(() => {
	const win = document.querySelector('.board-node[data-path="boards/notes.html"] iframe').contentWindow;
	const run = win.document.querySelector("[contenteditable='true']");
	return { tag: run?.tagName ?? null, text: (run?.textContent ?? "").slice(0, 30) };
});
say("a double-click in a document opens the run of words", opened.tag !== null && opened.text.length > 4, JSON.stringify(opened));
say("…and not the file as source", (await sourceEditor()) === false, "no source editor");

/*
 * 2. Typing in it moves one line of the file, and nothing else.
 *
 * A marker on the frame's own window first: the editor mutates the DOM it is typing into, so
 * a reload would be invisible in the file and obvious here — and a reload is what the browser
 * does when the pin is dropped, which is the bug this asserts against.
 */
await page.evaluate(() => {
	document.querySelector('.board-node[data-path="boards/notes.html"] iframe').contentWindow.__stillHere = 7;
});
await page.keyboard.press("End");
await page.keyboard.type(" And that is the finding.");
await frame().locator(".doc h2").first().click();
await settle(page, 900);

const after = read(file);
const before = original.split("\n");
const moved = after.split("\n").filter((line, index) => line !== before[index]);
say(
	"typing in a run moves one line of the file",
	moved.length === 1 && moved[0].includes("And that is the finding."),
	`${moved.length} line(s): ${moved.map((line) => JSON.stringify(line)).join(" ")}`,
);
say("…and leaves the rest of it byte for byte", after.split("\n").length === before.length, `${before.length} lines before, ${after.split("\n").length} after`);
say(
	"…and redraws rather than reloads the document",
	(await page.evaluate(() => document.querySelector('.board-node[data-path="boards/notes.html"] iframe').contentWindow.__stillHere)) === 7,
	"a reload would have taken the marker with it",
);
say(
	"…and the words are still there to read afterwards",
	(await paragraph.textContent()).includes("And that is the finding."),
	JSON.stringify((await paragraph.textContent()).slice(-40)),
);

/*
 * 3. The geometry half is off, because a document has no grid to place anything on.
 */
const geometry = await page.evaluate(() => {
	const win = document.querySelector('.board-node[data-path="boards/notes.html"] iframe').contentWindow;
	const handle = win.document.querySelector(".decks-handle");
	return { handle: handle ? getComputedStyle(handle).display : "absent" };
});
say("a document offers no resize handle", geometry.handle === "none" || geometry.handle === "absent", String(geometry.handle));

const was = read(file);
const box = await frame().locator(".doc").boundingBox();
await page.mouse.move(box.x + 40, box.y + box.height - 40);
await page.mouse.down();
await page.mouse.move(box.x + 220, box.y + box.height - 40);
await page.mouse.up();
await settle(page, 700);
say("…and dragging it writes nothing at all", read(file) === was, "the file is untouched by a drag");

/*
 * 4. And ⌥ asks for the bytes, which is the way in that has to keep working on a board whose
 *    markup a gesture cannot express — the reason the source editor was kept at all.
 */
await frame().locator(".doc h2").first().dblclick({ modifiers: ["Alt"] });
await settle(page, 800);
say("⌥ double-click asks for the file instead", await sourceEditor(), "the source editor is open");
await page.keyboard.press("Escape");
await settle(page, 400);
say("…and Escape closes it", (await sourceEditor()) === false, "no source editor");

// Put the fixture back the way the next check expects it.
write(file, original);
await settle(page, 600);

say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
