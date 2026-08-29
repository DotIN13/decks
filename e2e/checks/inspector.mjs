/**
 * The inspector (DESIGN §6.5): what a component *is*, edited from the panel and typed in
 * place, landing in the file as a splice of the lines it named and nothing else.
 *
 * The assertions that matter here are about the file, not the screen. A board is read
 * back by an agent, so an edit that reflows a paragraph, or writes the editor's own
 * selection class into the markup, is a bug even when it looks right.
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
		<section class="card" data-id="goal" style="left: 48px; top: 48px; width: 380px">
			<h3>Goal</h3>
			<p>
				A second tab that wakes up must not spend a token the first tab already
				spent.
			</p>
		</section>
		<div class="sticky" data-id="note" style="left: 520px; top: 48px; width: 240px">Refresh races</div>
		<svg class="link" data-id="goal-note" data-from="goal" data-to="note"></svg>
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
		body.split("\n").slice(9, 13).join("⏎"),
	);

	// --- the connector: selected by its line, repointed, renamed into ------------------

	const at = await page.evaluate((wanted) => {
		const element = document.querySelector(`.board-node[data-path="${wanted}"] iframe`);
		const rect = element.getBoundingClientRect();
		const scale = rect.width / element.clientWidth;
		// `> path`: the first path inside the svg is the arrowhead, in the marker's defs.
		const line = element.contentDocument.querySelector('[data-id="goal-note"] > path');
		const middle = line.getPointAtLength(line.getTotalLength() / 2);
		return { x: rect.left + middle.x * scale, y: rect.top + middle.y * scale };
	}, path);
	await page.mouse.click(at.x, at.y);
	await page.waitForTimeout(300);
	say(
		"a connector is selected by clicking its line",
		(await page.locator(".inspector header .what").textContent()) === "connector",
		"board.css gives the svg no pointer events; board.js draws a wide invisible copy for this",
	);

	await page.locator('.inspector input[name="label"]').fill("spends");
	await page.locator('.inspector input[name="label"]').press("Enter");
	const labelled = await until(fixture, /data-label="spends"/);
	say(
		"a connector can be labelled",
		/<svg class="link" data-id="goal-note" data-from="goal" data-to="note" data-label="spends"><\/svg>/.test(labelled),
	);

	await pick("goal");
	const name = page.locator('.inspector input[name="name"]');
	await name.fill("objective");
	await name.press("Enter");
	const renamed = await until(fixture, /data-id="objective"/);
	say(
		"renaming a component takes the connectors that named it",
		renamed.includes('data-id="objective"') && renamed.includes('data-from="objective"') && !renamed.includes('"goal"'),
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
		sent.split("\n").slice(8, 10).join("⏎"),
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

	// --- the arrow tool: two clicks, not a box to place --------------------------------

	await page.locator('.palette button[title^="Connect"]').click();
	await frame().locator('[data-id="note"]').click({ position: { x: 20, y: 12 } });
	await frame().locator('[data-id="objective"]').click({ position: { x: 20, y: 12 } });
	const connected = await until(fixture, /data-id="arrow-1"/);
	say(
		"the arrow tool connects two components in two clicks",
		/<svg class="link" data-id="arrow-1" data-from="note" data-to="objective"><\/svg>/.test(connected),
		connected.split("\n").filter((line) => line.includes("svg class")).length + " connectors now",
	);
	say(
		"and the tool goes back to select",
		await page.evaluate(() => document.querySelector('.palette button[data-active="true"]')?.title?.startsWith("Select") ?? false),
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
