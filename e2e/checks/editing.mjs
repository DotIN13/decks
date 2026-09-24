/**
 * A flow document, edited as fields rather than as its own source.
 *
 * A flow board's DOM tree *is* the file's tree — that is the condition the field editor
 * needs, and the reason it runs here at all: the patch ops that retype a run address it by
 * component id plus element-child indices and splice the bytes, leaving every byte nobody
 * touched alone. A markdown board is the case where that argument fails, because what is on
 * screen was drawn from words that are not in the file, and it keeps the source editor.
 *
 * So the assertions are the ones that matter for an edit anywhere in this app: **the bytes that
 * changed are inside the run that was opened**, its own tags and every other tag are as the file had
 * them, and the frame was not reloaded to show what the editor had already drawn. A *region* of the
 * file, not a count of lines — the harness says why, and the reason is not academic: the count this
 * replaced reported 24 lines for one retyped paragraph, because the editor's collapse of the run's
 * wrapping removes two lines and every line after a deletion differs at its own index. Plus the half that must *not* run: a document has no
 * grid, no box to resize and nowhere to place a component, so the geometry half is off.
 */
import { boardPath, differ, open, rangeOf, read, resetStage, say, settle, write } from "../harness.mjs";

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
await page.locator('.bar-layer .chrome[data-path="boards/notes.html"]').dblclick({ position: { x: 24, y: 12 } });
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
	// `plaintext-only` rather than `true`: a run is a plaintext surface now, so a board's markup stays
	// the file's business.
	const run = win.document.querySelector("[contenteditable]");
	return { tag: run?.tagName ?? null, text: (run?.textContent ?? "").slice(0, 30) };
});
say("a double-click in a document opens the run of words", opened.tag !== null && opened.text.length > 4, JSON.stringify(opened));
say("…and not the file as source", (await sourceEditor()) === false, "no source editor");

/*
 * 2. Typing in it rewrites the bytes of that run, and nothing outside them.
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
const diff = differ(original, after);
const run = rangeOf(original, "p");
say(
	"typing in a run rewrites bytes inside the run it opened, and nowhere else",
	/*
	 * The typed words are looked for in the **whole new file**, not in the changed region: a minimal region
	 * excludes every character that matches at the ends, and "And that is the finding." keeps the full stop
	 * the paragraph already ended with — so the region ends at "…finding" and the assertion would fail on a
	 * diff that is exactly right.
	 */
	run !== undefined && diff.start >= run.start && diff.endBefore <= run.end && after.includes("And that is the finding."),
	`${diff.after.length} byte(s) rewritten at ${diff.start}…${diff.endBefore} of ${original.length}${run ? `, inside the <p> at ${run.start}…${run.end}` : ", and there is no <p> in the file"} — now reads ${JSON.stringify(diff.after.slice(-90))}`,
);
say(
	"…and leaves that run's own tags — and every other tag — as the file had them",
	run !== undefined && diff.start >= run.open && diff.endBefore <= run.close && diff.tags.after === diff.tags.before,
	`the change starts ${run ? diff.start - run.open : -1} byte(s) inside the <p>; ${diff.tags.before} → ${diff.tags.after} tag(s), ${diff.lines.before} → ${diff.lines.after} line(s)`,
);
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

/*
 * A press **outside the board** ends the edit.
 *
 * The frame is a document of its own, so a press on the canvas is invisible from inside it — and a `<div>`
 * takes no focus by itself, so the frame never learned it had lost focus: measured, the run stayed
 * `contenteditable` with its border drawn after somebody had visibly clicked away. The app moves focus to
 * the canvas for a press that named no board, and the editor closes on the frame's window losing focus.
 *
 * Nothing is written by the press: the run had not been typed into, so the commit finds no change.
 */
const openRun = async () =>
	page.evaluate(() => {
		const doc = document.querySelector('.board-node[data-path="boards/notes.html"] iframe').contentDocument;
		return [...doc.querySelectorAll("[contenteditable]")].filter((e) => e.getAttribute("contenteditable") !== "false").length;
	});
/*
 * 5. A press inside a *named inner block* edits all the same.
 *
 * Report boards name their inner sections — a `data-id` on a div inside the doc — so a
 * comment can point at one. The nearest name is not the component: the editor climbs to
 * the child of the body. Before it climbed, every press inside such a block resolved to
 * nothing, and the whole pane read as not editable — measured, on the deck's tabbed
 * report boards.
 */
const nestedBefore = read(file);
// The block is the last thing in the document, below the viewport at the zoom the check
// chose — and a pan-zoom canvas is not a page Playwright can scroll, so pan the camera
// down with the wheel until the paragraph is on screen. Panning, not zooming: a frame
// click is only mapped straight at the zoom the earlier sections already vouched for.
let aimed;
for (let i = 0; i < 10; i++) {
	aimed = await frame().locator('[data-id="method"] p').boundingBox();
	if (aimed && aimed.y > 60 && aimed.y + aimed.height < 900) break;
	await page.mouse.move(720, 500);
	await page.mouse.wheel(0, 240);
	await settle(page, 250);
}
say("the named block can be brought on screen", Boolean(aimed && aimed.y > 60 && aimed.y + aimed.height < 900), JSON.stringify(aimed));
await frame().locator('[data-id="method"] p').dblclick();
await settle(page, 400);
say("a double-click inside a named inner block still opens its run", (await openRun()) === 1, `${await openRun()} open`);
await page.keyboard.press("End");
await page.keyboard.type(" Typed in the nested block.");
/*
 * Away from the run, to commit it — on the *panel*, not on the board's own heading.
 *
 * The heading is at the top of a board this check has panned down, so it is off screen, and the
 * click only used to land because opening the run moved the camera there: the editor asked to
 * reveal the whole page and `keepVisible` flew to its top. That is fixed (5c), so the way out
 * has to be somewhere that is on screen whatever the camera is doing. Anywhere outside the
 * frame does it: the run commits on `focusout`.
 */
await page.mouse.click(24, 700);
await settle(page, 900);
const nestedAfter = read(file);
const blockAt = nestedAfter.indexOf('data-id="method"');
const typedAt = nestedAfter.indexOf("Typed in the nested block.");
say(
	"…and typing there splices bytes inside that block's own paragraph",
	blockAt !== -1 && typedAt > blockAt && typedAt < nestedAfter.indexOf("</div>", blockAt),
	`typed at ${typedAt}, the named block opens at ${blockAt} of ${nestedAfter.length}`,
);
say("…and the rest of the file is as it was", differ(nestedBefore, nestedAfter).tags.before === differ(nestedBefore, nestedAfter).tags.after, "no tag changed");

/*
 * 5b. A single press picks the block under it, and keeps it outlined.
 *
 * A board written as a document is one block filling the board, so the selection the app
 * makes is that whole page — which said nothing about what a press had landed on. The
 * outline now goes on the element the hover outlined, and stays there when the pointer
 * moves away. What it does *not* get is a handle: a block the page lays out has nowhere to
 * be dragged or resized to, and the file would ignore the numbers.
 */
{
	const was = read(file);
	await frame().locator(".doc p").first().click();
	await settle(page, 400);
	const picked = await page.evaluate(() => {
		const doc = document.querySelector('.board-node[data-path="boards/notes.html"] iframe').contentDocument;
		const outlined = [...doc.querySelectorAll(".decks-editing")];
		return {
			tags: outlined.map((element) => element.tagName.toLowerCase()),
			width: outlined[0] ? Math.round(outlined[0].getBoundingClientRect().width) : 0,
			page: Math.round(doc.querySelector(".doc").getBoundingClientRect().width),
			outline: outlined[0] ? getComputedStyle(outlined[0]).outlineWidth : "none",
			handle: getComputedStyle(doc.querySelector(".decks-handle")).display,
		};
	});
	say(
		"a press on a paragraph outlines that paragraph, not the page around it",
		picked.tags.length === 1 && picked.tags[0] === "p" && picked.width < picked.page && picked.outline !== "0px",
		JSON.stringify(picked),
	);
	// Away from it: the outline is the selection's, not the pointer's.
	await page.mouse.move(24, 940);
	await settle(page, 300);
	const kept = await page.evaluate(() => {
		const doc = document.querySelector('.board-node[data-path="boards/notes.html"] iframe').contentDocument;
		return { outlined: doc.querySelectorAll(".decks-editing").length, hovered: doc.querySelectorAll(".decks-hover").length };
	});
	say("…and it stays outlined when the pointer leaves", kept.outlined === 1 && kept.hovered === 0, JSON.stringify(kept));
	say("…with no handle to resize it by", picked.handle === "none", picked.handle);
	say("…and the press wrote nothing", read(file) === was, "the file is untouched by a selection");
}

/*
 * 5c. And opening a run does not move the camera out from under it.
 *
 * The editor asks the camera to keep what is being typed in view, for the on-screen keyboard.
 * It used to ask for the whole *component*, which on a board written as a document is the page:
 * a box taller than the screen, which `keepVisible` aligns to its top — so a double-click half
 * way down a board flew the board up and took the caret off the bottom with it. Measured before
 * the fix, on a board at 100%: the camera moved 177px.
 */
{
	const camera = () => page.evaluate(() => {
		const m = new DOMMatrix(getComputedStyle(document.querySelector(".world")).transform);
		return { x: Math.round(m.e), y: Math.round(m.f) };
	});
	const onScreen = () => page.evaluate(() => {
		const node = document.querySelector('.board-node[data-path="boards/notes.html"] iframe');
		const run = node?.contentDocument?.querySelector("[contenteditable='plaintext-only']");
		if (!node || !run) return null;
		const frame = node.getBoundingClientRect();
		const k = frame.width / node.clientWidth;
		const box = run.getBoundingClientRect();
		const top = frame.y + box.y * k;
		const stage = document.querySelector(".stage").getBoundingClientRect();
		return { top: Math.round(top), bottom: Math.round(top + box.height * k), within: Math.round(stage.height) };
	});
	// A paragraph that is already fully on screen: bringing one into view is the feature, and
	// what is asserted here is that opening one that needs nothing moves nothing.
	const at = await page.evaluate(() => {
		const node = document.querySelector('.board-node[data-path="boards/notes.html"] iframe');
		const frame = node.getBoundingClientRect();
		const k = frame.width / node.clientWidth;
		const stage = document.querySelector(".stage").getBoundingClientRect();
		for (const element of node.contentDocument.querySelectorAll(".doc p")) {
			const box = element.getBoundingClientRect();
			const top = frame.y + box.y * k;
			const bottom = top + box.height * k;
			if (top > stage.y + 120 && bottom < stage.y + stage.height - 220) return { x: frame.x + (box.x + 30) * k, y: (top + bottom) / 2 };
		}
		return null;
	});
	say("a paragraph is fully on screen to open", at !== null, JSON.stringify(at));
	const was = await camera();
	await page.mouse.dblclick(at.x, at.y);
	await settle(page, 700);
	const now = await camera();
	const caret = await onScreen();
	say(
		"opening a run for typing leaves the camera where it was",
		Math.abs(now.x - was.x) <= 2 && Math.abs(now.y - was.y) <= 2,
		JSON.stringify({ was, now }),
	);
	say(
		"…so the words being typed are still on the screen",
		caret !== null && caret.top > 0 && caret.bottom < caret.within,
		JSON.stringify(caret),
	);
	await page.keyboard.press("Escape");
	await settle(page, 300);
}

const beforePressAway = read(file);
await frame().locator(".doc p").first().dblclick();
await settle(page, 600);
say("a run is open before the press", (await openRun()) === 1, `${await openRun()} open`);
await page.mouse.click(24, 940);
await settle(page, 800);
say("a press on the canvas outside the board ends the edit", (await openRun()) === 0, `${await openRun()} still open`);
say("…and writes nothing, because nothing was typed", read(file) === beforePressAway, "the file is unchanged");

// Put the fixture back the way the next check expects it.
write(file, original);
await settle(page, 600);

say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
