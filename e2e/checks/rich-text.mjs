/**
 * A run of words with marks in it, edited in place as rich text.
 *
 * The case that used to be refused outright: `See <a>the doc</a>, then <b>ship it</b>` has no
 * plain-text form, so sending the words alone would have thrown the link and the bold away.
 * The `html` patch sends the element's inner HTML instead, and the server decides what a
 * board file may hold (`boards/inline-html.ts`).
 *
 * Two halves, and the second is the one worth a browser. The normalising is unit-tested
 * against every mess an engine makes; what only a real `contenteditable` can show is that
 * the mess *arrives* — that this path is wired up, and that the marks the author wrote come
 * out of the other end byte-identical.
 */
import { rmSync } from "node:fs";
import { boardPath, open, read, say, socket, write } from "../harness.mjs";

async function until(file, pattern, timeout = 15000) {
	const deadline = Date.now() + timeout;
	let last = "";
	while (Date.now() < deadline) {
		last = read(file);
		if (pattern.test(last)) return last;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	return last;
}

const fixture = await boardPath("rich-fixture.html");
const path = "boards/rich-fixture.html";
const PARAGRAPH = '<p>See <a href="../docs/notes.md">the doc</a>, then <b>ship it</b> and tell <i>everyone</i>.</p>';

write(
	fixture,
	`<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>Rich fixture</title>
		<meta name="board" content='{"w":1200,"h":800,"bg":"grid"}' />
		<link rel="stylesheet" href="../lib/board.css" />
	</head>
	<body class="board">
		<div class="text" data-id="intro" style="left: 48px; top: 48px; width: 560px">
			${PARAGRAPH}
		</div>
		<section class="card" data-id="goal" style="left: 48px; top: 200px; width: 420px">
			<h3>Goal</h3>
			<p>One session, one refresh.</p>
		</section>
		<script src="../lib/board.js"></script>
	</body>
</html>
`,
);

const link = await socket();
link.send({ type: "board.play", path });
await new Promise((resolve) => setTimeout(resolve, 500));
link.close();

const { browser, page, errors } = await open();
const frame = () => page.frameLocator(`.board-node[data-path="${path}"] iframe`);
const inFrame = (fn) =>
	page.evaluate(
		([selector, body]) => {
			const doc = document.querySelector(selector).contentDocument;
			return new Function("doc", body)(doc);
		},
		[`.board-node[data-path="${path}"] iframe`, fn],
	);
const line = (needle) => read(fixture).split("\n").find((text) => text.includes(needle))?.trim();

try {
	await page.waitForFunction(
		(wanted) => document.querySelector(`.board-node[data-path="${wanted}"] iframe`)?.contentWindow?.__boardReady === true,
		path,
		{ timeout: 20000 },
	);
	/*
	 * Fly to this board, which is what makes any of this reachable: below `INTERACT_ZOOM` a
	 * frame takes no pointer events at all, and a camera fitted to a whole deck is well
	 * below it. Clicking the rail item is the user's own way of asking for one board.
	 */
	await page.evaluate(() => {
		[...document.querySelectorAll(".rail-item")].find((item) => item.textContent.includes("rich-fixture"))?.click();
	});
	await page.waitForSelector(".palette", { state: "visible", timeout: 8000 });
	await page.waitForTimeout(400);

	// --- what counts as one field ------------------------------------------------------

	await frame().locator('[data-id="intro"] b').dblclick();
	await page.waitForTimeout(300);
	const field = await inFrame("const a = doc.activeElement; return a?.isContentEditable ? a.tagName.toLowerCase() : null;");
	say("clicking a bold word opens the paragraph around it, not the mark", field === "p", String(field));

	await page.keyboard.press("Escape");
	await page.waitForTimeout(200);
	await frame().locator('[data-id="goal"] h3').dblclick();
	await page.waitForTimeout(300);
	const heading = await inFrame("const a = doc.activeElement; return a?.isContentEditable ? a.tagName.toLowerCase() : null;");
	say("…and a card's heading stops at the heading, not the card", heading === "h3", String(heading));
	await page.keyboard.press("Escape");
	await page.waitForTimeout(200);

	// --- typing through a mark ----------------------------------------------------------

	await frame().locator('[data-id="intro"] p').dblclick();
	await page.waitForTimeout(300);
	// The caret at the end of the bold, then more words: the mark should grow, not split.
	await inFrame(`
		const b = doc.querySelector('[data-id="intro"] b');
		const range = doc.createRange();
		range.setStart(b.firstChild, b.firstChild.length);
		range.collapse(true);
		const selection = doc.defaultView.getSelection();
		selection.removeAllRanges();
		selection.addRange(range);
	`);
	await page.keyboard.type(" now");
	await page.keyboard.press("ControlOrMeta+Enter");
	const typed = await until(fixture, /ship it now/);
	say(
		"typing at the end of a mark extends it rather than splitting it",
		/<b>ship it now<\/b>/.test(typed),
		line("See <a"),
	);
	say(
		"…and the link beside it is byte-identical",
		typed.includes('<a href="../docs/notes.md">the doc</a>'),
		line("See <a"),
	);

	// --- a mark added with the browser's own command -------------------------------------

	await frame().locator('[data-id="intro"] p').dblclick();
	await page.waitForTimeout(300);
	await inFrame(`
		const i = doc.querySelector('[data-id="intro"] i');
		const range = doc.createRange();
		range.selectNodeContents(i);
		const selection = doc.defaultView.getSelection();
		selection.removeAllRanges();
		selection.addRange(range);
		doc.execCommand("bold");
	`);
	await page.keyboard.press("ControlOrMeta+Enter");
	const bolded = await until(fixture, /<i><b>everyone<\/b><\/i>|<b><i>everyone<\/i><\/b>/);
	say(
		"a mark the user adds is written into the file",
		/<i><b>everyone<\/b><\/i>|<b><i>everyone<\/i><\/b>/.test(bolded),
		line("See <a"),
	);

	// --- and everything an engine or a paste brings with it ------------------------------

	/*
	 * The mess, all at once, put into the field the way an engine and a clipboard would: a
	 * mark split by typing across its end, an empty one left by a delete, one nested inside
	 * itself, a paste carrying `style`/`id`/`class` and a `<div>`, a non-breaking space at an
	 * inline edge, and a `<script>` — because the server is what decides, not the client.
	 */
	await frame().locator('[data-id="intro"] p').dblclick();
	await page.waitForTimeout(300);
	await inFrame(`
		doc.querySelector('[data-id="intro"] p').innerHTML =
			'See <a href="../docs/notes.md">the doc</a>, then <b>ship</b><b> it</b><i></i>\\u00A0' +
			'<span style="font-weight: 700" id="pasted" class="kept">now</span>' +
			'<em><em>really</em></em><div>and a block</div><scr' + 'ipt>alert(1)</scr' + 'ipt>.';
	`);
	await page.keyboard.press("ControlOrMeta+Enter");
	const cleaned = await until(fixture, /class="kept"/);
	const paragraph = line("See <a") ?? "";
	say("a split mark is merged", /<b>ship it<\/b>/.test(cleaned), paragraph);
	say("an empty mark is dropped", !/<i><\/i>/.test(cleaned));
	say("a mark nested in itself is flattened", /<em>really<\/em>/.test(cleaned) && !/<em><em>/.test(cleaned));
	say("style and id are stripped and class is kept", /<span class="kept">now<\/span>/.test(cleaned));
	say("a block is unwrapped to its words", /and a block/.test(cleaned) && !/<div>and a block/.test(cleaned));
	// The paragraph, not the file: every board carries its own `<script src="../lib/board.js">`,
	// which is the author's and is nothing to do with what was typed into a run of words.
	say("a script is unwrapped to its words and never reaches the markup", !/<script/.test(paragraph) && /alert\(1\)/.test(paragraph), paragraph);
	say("a non-breaking space comes back as a space", !cleaned.includes(" "));
	say("and the author's link is still byte-identical", cleaned.includes('<a href="../docs/notes.md">the doc</a>'));

	// --- a no-op commit writes nothing ---------------------------------------------------

	const before = read(fixture);
	await frame().locator('[data-id="intro"] p').dblclick();
	await page.waitForTimeout(300);
	await page.keyboard.press("ControlOrMeta+Enter");
	await page.waitForTimeout(900);
	say("opening a run and committing it unchanged writes nothing", read(fixture) === before);

	say("no page errors", errors.length === 0, errors.join(" | "));
} finally {
	rmSync(fixture, { force: true });
	await page.waitForTimeout(600);
	await browser.close();
}
