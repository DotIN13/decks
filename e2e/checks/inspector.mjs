/**
 * The inspector (DESIGN §6.5): what a component *is*, edited from the panel and typed in
 * place, landing in the file as a splice of the lines it named and nothing else.
 *
 * The assertions that matter here are about the file, not the screen. A board is read
 * back by an agent, so an edit that reflows a paragraph, or writes the editor's own
 * selection class into the markup, is a bug even when it looks right.
 *
 * The fixture carries a drawn diagram and a bare `<svg>` where it used to carry a
 * connector. Those are the two shapes whose family the *tag* used to decide — an `<svg>`
 * was a connector by construction — so they are what proves nothing goes by the tag any
 * more: one is a `card` with every appearance row, the other an `other` with none. The
 * dead `svg.link` at the top of the fixture is the third: it is what a board written
 * against the old runtime looks like, and it must draw as nothing at all.
 */
import { rmSync } from "node:fs";
import { boardPath, open, read, say, socket, write } from "../harness.mjs";

/**
 * Wait until the file *says* something, rather than until it differs.
 *
 * `changed` returns on the first write, and an edit here can arrive as two — the patch
 * the click sent, and whatever was queued behind it (§6.5). Waiting on the condition is
 * both stricter and not a race.
 */
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

const fixture = await boardPath("inspector-fixture.html");
const path = "boards/inspector-fixture.html";

const original = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>Inspector fixture</title>
		<meta name="board" content='{"w":1200,"h":800,"bg":"grid"}' />
		<link rel="stylesheet" href="../lib/board.css" />
	</head>
	<body class="board">
		<!--
			A board written against the old runtime, which drew a curve between the two
			components an svg.link named. Nothing draws it now, and this is here to say so:
			lib/ is re-synced on every open (DESIGN §2.1), so such a board loses its arrows
			rather than half-drawing them. First in the body deliberately — with no left/top
			it lands at 0,0 at its own intrinsic size, and later in the document it would sit
			over the card and eat the clicks meant for it.
		-->
		<svg class="link" data-id="stale-arrow" data-from="goal" data-to="note"></svg>
		<section class="card" data-id="goal" style="left: 48px; top: 48px; width: 380px">
			<h3>Goal</h3>
			<p>
				A second tab that wakes up must not spend a token the first tab already
				spent.
			</p>
		</section>
		<div class="sticky" data-id="note" style="left: 520px; top: 48px; width: 240px">Refresh races</div>
		<section class="card flow" data-id="diagram" style="left: 48px; top: 320px; width: 380px; height: 220px">
			<h3>The claim</h3>
			<svg viewBox="0 0 340 120" width="100%" height="120">
				<rect x="1" y="8" width="96" height="34" rx="6" fill="none" stroke="#888888" />
				<text x="49" y="30" text-anchor="middle">tab A</text>
				<path d="M 97 25 H 130" fill="none" stroke="#888888" />
			</svg>
		</section>
		<!--
			Filled, not outlined: only the parts of an SVG that paint take a pointer event,
			so a hollow drawing is a component nobody can click. One more reason the
			authoring skill puts a drawing inside a box.
		-->
		<svg class="bare" data-id="bare" viewBox="0 0 200 120" width="200" height="120" style="left: 820px; top: 320px">
			<rect x="1" y="1" width="198" height="118" fill="#dddddd" stroke="#888888" />
		</svg>
		<script src="../lib/board.js"></script>
	</body>
</html>
`;
write(fixture, original);

// A board nobody has in play is not on the canvas, so the fixture is played as well as
// written — and only it, so the camera lands close enough for the frame to be live.
const link = await socket();
link.send({ type: "board.play", path });
await new Promise((resolve) => setTimeout(resolve, 500));
link.close();

const { browser, page, errors } = await open();
try {
	await page.waitForFunction(
		(wanted) => document.querySelector(`.board-node[data-path="${wanted}"] iframe`)?.contentWindow?.__boardReady === true,
		path,
		{ timeout: 20000 },
	);
	await page.evaluate((wanted) => {
		[...document.querySelectorAll(".rail-item")].find((item) => item.textContent.includes(wanted))?.click();
	}, "inspector-fixture");
	await page.waitForSelector(".palette", { state: "visible", timeout: 8000 });

	const frame = () => page.frameLocator(`.board-node[data-path="${path}"] iframe`);
	const inspector = page.locator(".inspector");
	const pick = async (id, dx = 24, dy = 12) => {
		const box = await frame().locator(`[data-id="${id}"]`).boundingBox();
		await page.mouse.click(box.x + dx, box.y + dy);
		await inspector.waitFor({ timeout: 5000 });
	};

	// --- the connector is gone from the runtime, not merely from the palette -----------

	say(
		"an svg.link left over in a board is drawn as nothing at all",
		await page.evaluate((wanted) => {
			const stale = document
				.querySelector(`.board-node[data-path="${wanted}"] iframe`)
				.contentDocument.querySelector("svg.link[data-from][data-to]");
			return stale !== null && stale.childElementCount === 0;
		}, path),
		"board.js used to fill it with a curve, an arrowhead and an invisible copy to click",
	);

	// --- it appears for the selection, and says what the thing is ---------------------

	say("no inspector with nothing selected", (await inspector.count()) === 0);
	await pick("note");
	say("selecting a component opens the inspector", await inspector.isVisible());
	say(
		"it names the component the way the file does",
		(await page.locator(".inspector header .what").textContent()) === "sticky" &&
			(await page.locator('.inspector input[name="name"]').inputValue()) === "note",
	);
	say(
		"a sticky is offered no tone, because board.css styles none",
		(await page.locator(".inspector .tones").count()) === 0,
	);

	// --- appearance: the class, then the tone -----------------------------------------

	await page.locator('.inspector button[data-box="callout"]').click();
	const wantCallout = /<div class="callout" data-id="note" style="left: 520px; top: 48px; width: 240px">Refresh races<\/div>/;
	const toned = await until(fixture, wantCallout);
	say(
		"a sticky becomes a callout by its class alone",
		wantCallout.test(toned),
		toned.split("\n").find((line) => line.includes('data-id="note"'))?.trim(),
	);
	say(
		"the editor's own selection class is not written to the file",
		!toned.includes("decks-editing"),
		"class swaps send the whole attribute, and the overlay lives in that document too",
	);
	say("a callout is offered the tones it has", (await page.locator(".inspector .tones button").count()) === 4);

	await page.locator('.inspector .tones button[data-tone="warn"]').click();
	const wantTone = /<div class="callout" data-id="note" style="[^"]*" data-tone="warn">/;
	const warned = await until(fixture, wantTone);
	say(
		"a tone is one attribute at the end of the tag",
		wantTone.test(warned),
		warned.split("\n").find((line) => line.includes('data-id="note"'))?.trim(),
	);

	await page.locator('.inspector .tones button[data-tone="default"]').click();
	const cleared = await until(fixture, /class="callout" data-id="note" style="[^"]*">/);
	say(
		"clearing the tone removes the attribute rather than emptying it",
		!cleared.includes("data-tone") && cleared.includes('class="callout" data-id="note"'),
	);

	// --- a burst of clicks is one batch, not a storm of refusals ----------------------

	for (const tone of ["ok", "danger", "warn"]) {
		await page.locator(`.inspector .tones button[data-tone="${tone}"]`).click();
	}
	const settled = await until(fixture, /data-tone="warn"/);
	await page.waitForTimeout(1200);
	const stormed = await page.locator('.notice[data-level="warn"]').allTextContents();
	say(
		"a burst of edits is queued and coalesced, with no stale-patch warning",
		stormed.length === 0 && settled.includes('data-tone="warn"'),
		stormed.join(" | ") || "no warnings",
	);

	// --- typing in place, addressing a child -----------------------------------------

	await frame().locator('[data-id="goal"] h3').dblclick();
	await page.keyboard.type("Ship it");
	await page.keyboard.press("Meta+Enter");
	const retyped = await until(fixture, /<h3>Ship it<\/h3>/);
	say("a card's heading can be retyped in place", retyped.includes("<h3>Ship it</h3>"));
	say(
		"and its paragraph is untouched, indentation and wrapping included",
		retyped.includes("\t\t\t\tA second tab that wakes up must not spend a token the first tab already\n"),
	);

	await frame().locator('[data-id="goal"] p').dblclick();
	await page.keyboard.type("One session, two tabs.");
	await page.keyboard.press("Meta+Enter");
	const body = await until(fixture, /One session, two tabs\./);
	say(
		"the body is a second, separate run of text",
		/<p>\n\t\t\t\tOne session, two tabs\.\n\t\t\t<\/p>/.test(body),
		body.split("\n").find((line) => line.includes("One session"))?.trim(),
	);

	// --- renaming, which is now a splice of one attribute ------------------------------

	const beforeRename = read(fixture);
	await pick("goal");
	const name = page.locator('.inspector input[name="name"]');
	await name.fill("objective");
	await name.press("Enter");
	const renamed = await until(fixture, /data-id="objective"/);
	say(
		"renaming writes the new name",
		renamed.includes('<section class="card" data-id="objective" style="left: 48px; top: 48px; width: 380px">') &&
			!renamed.includes('data-id="goal"'),
		renamed.split("\n").find((line) => line.includes('data-id="objective"'))?.trim(),
	);
	say(
		"and exactly one line moved — it no longer chases what named the old id",
		renamed.split("\n").filter((line, index) => line !== beforeRename.split("\n")[index]).length === 1 &&
			renamed.includes('data-from="goal" data-to="note"'),
		renamed.split("\n").find((line) => line.includes("svg class"))?.trim(),
	);

	// --- duplicate, which is the only copy that keeps the markup ----------------------

	await page.locator('.inspector button[data-act="duplicate"]').click();
	const copied = await until(fixture, /data-id="objective-2"/);
	say(
		"a duplicate is named after the original and offset",
		/<section class="card" data-id="objective-2" style="left: 64px; top: 64px; width: 380px">/.test(copied),
		copied.split("\n").find((line) => line.includes('data-id="objective-2"'))?.trim(),
	);
	say(
		"and it keeps what the component is made of",
		copied.includes("<h3>Ship it</h3>") && copied.match(/<h3>Ship it<\/h3>/g).length === 2,
	);

	// --- order, and a delete that leaves the screen as well as the file ----------------

	await pick("objective-2");
	await page.locator('.inspector button[data-act="back"]').click();
	const sent = await until(fixture, /<body class="board">\n\t\t<section class="card" data-id="objective-2"/);
	say(
		"send-to-back moves the component to the top of the body, keeping its indentation",
		/<body class="board">\n\t\t<section class="card" data-id="objective-2"/.test(sent),
		sent.split("\n").find((line) => line.includes('data-id="objective-2"'))?.trim(),
	);

	await page.locator('.inspector button[data-act="remove"]').click();
	const deleted = await until(fixture, /^(?![\s\S]*data-id="objective-2")[\s\S]*$/);
	say("delete takes the component out of the file", !deleted.includes('data-id="objective-2"'));
	say(
		"and off the screen, without waiting for a reload",
		(await frame().locator('[data-id="objective-2"]').count()) === 0,
		"the frame is pinned to the revision it loaded, so the DOM has to be edited too",
	);
	say("and the inspector goes with it", (await inspector.count()) === 0);

	// --- a diagram the author drew, which is what replaced the connector ---------------

	say(
		"the palette has no connect tool",
		(await page.locator('.palette button[title*="Connect"]').count()) === 0 &&
			(await page.locator(".palette button:not(.undo)").count()) === 5,
		(await page.locator(".palette button:not(.undo)").evaluateAll((buttons) => buttons.map((button) => button.title))).join(" | "),
	);

	await pick("diagram");
	say(
		"a drawn diagram is a box, because its author put a box class beside its own",
		(await page.locator(".inspector header .what").textContent()) === "card" &&
			(await page.locator(".inspector .row.boxes button").count()) === 5,
		"an <svg> used to be a connector by its tag alone; nothing goes by the tag now",
	);
	say(
		"and it has a resize handle, because the drawing is inside the box and is not the box",
		await page.evaluate(
			(wanted) =>
				document.querySelector(`.board-node[data-path="${wanted}"] iframe`).contentDocument.querySelector(".decks-handle")
					?.style.display === "block",
			path,
		),
	);

	// The one thing a drawing costs: the words in it stay the agent's, because
	// `contentEditable` is `HTMLElement`'s and an SVG `<text>` is not one.
	const beforeSvg = read(fixture);
	await frame().locator('[data-id="diagram"] text').dblclick();
	/*
	 * "Zoo" rather than a word that means something. A keystroke over a board with nothing
	 * editable under it falls through to the stage's own shortcuts, and `V S C T E` arm the
	 * palette — typing "tab" here armed the text tool, and the next click inserted a
	 * component instead of selecting one.
	 */
	await page.keyboard.type("Zoo");
	await page.keyboard.press("Meta+Enter");
	await page.waitForTimeout(600);
	say(
		"a word inside a drawing says so rather than pretending to be editable",
		read(fixture) === beforeSvg && (await page.locator(".notice").allTextContents()).some((text) => text.includes("coordinates")),
		(await page.locator(".notice").allTextContents()).join(" | ") || "no notice",
	);

	// --- a bare top-level <svg>: a component, with the rows that can still apply -------

	/*
	 * Clicked on the `rect` rather than at an offset from the component's corner: only the
	 * parts of an SVG that paint take a pointer event, and Playwright aims at the middle of
	 * whatever it is given.
	 */
	await frame().locator('[data-id="bare"] rect').click();
	await inspector.waitFor({ timeout: 5000 });
	say(
		"a bare <svg> is other, not a connector, and keeps the rows that still mean something",
		(await page.locator(".inspector header .what").textContent()) === "bare" &&
			(await page.locator(".inspector .row.boxes").count()) === 0 &&
			(await page.locator(".inspector .tones").count()) === 0 &&
			(await page.locator('.inspector button[data-act="duplicate"]').count()) === 1,
		`it says "${await page.locator(".inspector header .what").textContent()}"`,
	);
	say(
		"and gets no resize handle, because an SVGElement has no offsetWidth to measure",
		await page.evaluate(
			(wanted) =>
				document.querySelector(`.board-node[data-path="${wanted}"] iframe`).contentDocument.querySelector(".decks-handle")
					?.style.display === "none",
			path,
		),
	);

	// --- and it is off when the board is a map ----------------------------------------

	await page.keyboard.press("0");
	await page.waitForFunction(
		() => Number((document.querySelector(".zoombar .level")?.textContent ?? "100%").replace("%", "")) < 50,
		null,
		{ timeout: 5000 },
	);
	say("zoomed out past INTERACT_ZOOM the inspector goes away, like the palette", (await inspector.count()) === 0);

	say("no page errors", errors.length === 0, errors.join(" | "));
} finally {
	rmSync(fixture, { force: true });
	await page.waitForTimeout(600);
	await browser.close();
}
