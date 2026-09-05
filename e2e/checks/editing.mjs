/**
 * Direct manipulation (DESIGN §6.5): a drag rewrites one attribute of one line, undo is
 * byte-exact, and the palette inserts a component the server names.
 */
import { rmSync } from "node:fs";
import { boardPath, changed, open, read, say, socket, write } from "../harness.mjs";

const fixture = await boardPath("editing-fixture.html");

// Written here rather than assumed: this used to lean on a board an agent happened to
// leave behind, which made it pass or crash depending on what had run before it.
const original = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>Editing fixture</title>
		<meta name="board" content='{"w":1200,"h":800,"bg":"grid"}' />
		<link rel="stylesheet" href="../lib/board.css" />
	</head>
	<body class="board">
		<section class="card" data-id="what-a-deck-is" style="left: 48px; top: 48px; width: 480px">
			<h3>What a deck is</h3>
		</section>
		<script src="../lib/board.js"></script>
	</body>
</html>
`;
write(fixture, original);

// A board nobody has in play is not on the canvas, so the fixture has to be played as
// well as written — otherwise this waits for a frame that will never mount.
const link = await socket();
link.send({ type: "board.play", path: "boards/editing-fixture.html" });
await new Promise((resolve) => setTimeout(resolve, 500));
link.close();

const path = "boards/editing-fixture.html";
const { browser, page, errors } = await open({ edit: true });
try {
	await page.waitForFunction(
		(wanted) => document.querySelector(`.board-node[data-path="${wanted}"] iframe`)?.contentWindow?.__boardReady === true,
		path,
		{ timeout: 20000 },
	);

	// Zoom in so the frame is live and the palette appears.
	await page.evaluate((wanted) => {
		[...document.querySelectorAll(".board-row")].find((i) => i.textContent.includes(wanted))?.click();
	}, "editing-fixture");
	await page.waitForSelector(".palette", { state: "visible", timeout: 8000 });
	say("the palette appears at editing zoom", await page.locator(".palette").isVisible());

	const frame = () => page.frameLocator(`.board-node[data-path="${path}"] iframe`);

	// Drag the card by its own body, inside the frame.
	const before = await frame().locator('[data-id="what-a-deck-is"]').boundingBox();
	await page.mouse.move(before.x + 60, before.y + 12);
	await page.mouse.down();
	await page.mouse.move(before.x + 180, before.y + 92, { steps: 10 });
	await page.mouse.up();
	const dragged = await changed(fixture, original);

	const style = /style="left: (\d+)px; top: (\d+)px; width: 480px"/.exec(dragged);
	say("a drag rewrote the style attribute on disk", Boolean(style) && style[1] !== "48", `style now left:${style?.[1]} top:${style?.[2]}`);

	const differing = (() => {
		const a = original.split("\n");
		const b = dragged.split("\n");
		let changedLines = 0;
		for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) changedLines += 1;
		return changedLines;
	})();
	say("nothing else in the file moved", differing === 1, `${differing} line(s) differ`);
	say("the selection handle is drawn inside the frame", await frame().locator(".decks-handle").isVisible());

	// Undo: back to the fixture as written.
	await page.locator(`.board-node[data-path="${path}"] iframe`).click({ position: { x: 5, y: 5 } });
	await page.keyboard.press("Meta+z");
	const undone = await changed(fixture, dragged);
	say("undo restores the previous revision", undone.trim() === original.trim(), undone === original ? "byte-identical" : `differs by ${undone.length - original.length} bytes`);

	// Insert a sticky with the palette.
	await page.locator('.palette button[title^="Sticky"]').click();
	const box = await page.locator(`.board-node[data-path="${path}"] iframe`).boundingBox();
	await page.mouse.click(box.x + 300, box.y + 320);
	const inserted = await changed(fixture, undone);
	say(
		"the palette inserts a component the server names",
		/<div class="sticky" data-id="sticky-1"/.test(inserted),
		(inserted.match(/data-id="[^"]+"/g) ?? []).join(" "),
	);
	say(
		"the tool returns to select after an insert",
		await page.evaluate(() => document.querySelector('.palette button[data-on="true"]')?.title?.startsWith("Select") ?? false),
	);

	say("no page errors", errors.length === 0, errors.join(" | "));
} finally {
	rmSync(fixture, { force: true });
	await page.waitForTimeout(600);
	await browser.close();
}
