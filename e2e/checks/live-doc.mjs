/**
 * A document board: a board holding one `data-live="doc"` box, a page you type into, kept in step
 * with its markdown file (`lib/live-doc.js`).
 *
 * The page has no socket of its own: it posts its `doc.*` messages up, and the app carries them on
 * its own connection (`board/live-doc.ts`), attached to every board's frame by the canvas
 * (`boards.attach` in `mount.tsx`). When nothing attached it, every document board sat on
 * "Opening…" for ever, which is what this check is for:
 *
 * - the file's words show in the board;
 * - words typed in the board reach the file;
 * - and the file changed on disk shows in the board.
 */
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { deckState, flyToBoard, liveZoom, open, resetStage, say, settle, socket } from "../harness.mjs";

const until = async (test, ms = 10000) => {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await test();
		if (value || Date.now() > deadline) return value;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
};

await resetStage();
const deck = await deckState();
mkdirSync(join(deck.path, "notes"), { recursive: true });
writeFileSync(join(deck.path, "notes", "e2e-doc.md"), "# A document\n\nHello from the file.\n");
writeFileSync(
	join(deck.path, "boards", "e2e-doc.html"),
	`<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>e2e-doc.md</title>
		<meta name="board" content='{"w":800,"h":500,"bg":"plain"}' />
		<link rel="stylesheet" href="../lib/board.css" />
	</head>
	<body class="board">
		<div class="live" data-id="doc" data-live="doc" data-path="../notes/e2e-doc.md" style="left: 0; top: 0; right: 0; bottom: 0"></div>
		<script src="../lib/board.js"></script>
	</body>
</html>
`,
);

const link = await socket();
await until(() => link.last("agents")?.focused);
link.send({ type: "board.play", path: "boards/e2e-doc.html" });
await new Promise((resolve) => setTimeout(resolve, 800));
link.close();

const { browser, page } = await open({ width: 1400, height: 900, boards: false });
await settle(page, 1500);
const node = 'iframe[data-path$="e2e-doc.html"]';
const found = await until(() => page.locator(node).count(), 15000);
say("the document board is on the canvas", found > 0);

/** Every copy of the file in the deck: placing the board may bring it into the canvas's folder. */
const files = (dir = deck.path, out = []) => {
	for (const name of readdirSync(dir)) {
		if (name === "node_modules" || name === ".git") continue;
		const path = join(dir, name);
		if (statSync(path).isDirectory()) files(path, out);
		else if (name === "e2e-doc.md") out.push(path);
	}
	return out;
};

if (found) {
	const path = await page.locator(node).first().getAttribute("data-path");
	await flyToBoard(page, path);
	// Zoomed in far enough that the board's page is live and takes the pointer.
	await liveZoom(page);
	await settle(page, 800);
	const board = page.frameLocator(node).first();
	const shown = await until(async () => (await board.locator("body").innerText().catch(() => "")).includes("Hello from the file"), 15000);
	say("the file's words show in the board, not Opening…", shown, shown ? "" : (await board.locator("body").innerText().catch(() => "")).slice(0, 120));

	if (shown) {
		const words = board.getByText("Hello from the file.");
		await words.click();
		await page.keyboard.press("End");
		await page.keyboard.type(" Typed here.");
		const typed = await until(() => files().some((file) => readFileSync(file, "utf8").includes("Typed here.")), 10000);
		say("words typed in the board reach the file", typed, files().join(", "));

		for (const file of files()) writeFileSync(file, readFileSync(file, "utf8").replace("Hello from the file.", "Changed on disk."));
		const followed = await until(async () => (await board.locator("body").innerText().catch(() => "")).includes("Changed on disk"), 10000);
		say("the file changed on disk shows in the board", followed);
	}

	/*
	 * Selected, a document keeps its page while the camera moves: the other boards turn to pictures for
	 * the move, and a document's picture is not the page being typed in.
	 */
	await page.locator(".v3-zoom-value").first().waitFor({ timeout: 3000 }).catch(() => {});
	const box = await page.locator(node).first().boundingBox();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	const seen = [];
	for (let i = 0; i < 6; i++) {
		await page.mouse.wheel(0, 40);
		await page.waitForTimeout(30);
		seen.push(await page.evaluate((n) => {
			const frame = document.querySelector(n);
			return { pictures: document.querySelector(".stage")?.dataset.pictures === "true", shown: !!frame && getComputedStyle(frame).visibility !== "hidden" };
		}, node));
	}
	const moving = seen.filter((one) => one.pictures);
	say("selected, its page stays up while the camera moves", moving.length > 0 && moving.every((one) => one.shown), JSON.stringify(seen));
	await settle(page, 600);

	/*
	 * Not selected, it is drawn as a card with its icon and name while the camera moves, where the other
	 * boards are drawn as their pictures: a picture of a document is its page before the file came, and
	 * a fresh deck has none. Read as pixels: the card's middle has the icon and the name in it, where an
	 * empty picture is one flat colour.
	 */
	for (let i = 0; i < 3; i++) await page.keyboard.press("Control+Minus");
	await settle(page, 900);
	await page.mouse.click(1250, 700);
	await settle(page, 600);
	const unselected = await page.evaluate((n) => document.querySelector(n)?.closest(".board-node")?.dataset.selected !== "true", node);
	const rect = await page.evaluate((wanted) => window.__decksBoards?.().find((one) => one.path === wanted)?.rect, path);
	let spread = 0;
	let during = false;
	if (rect) {
		await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
		await page.mouse.wheel(0, 30);
		await page.waitForTimeout(40);
		await page.mouse.wheel(0, 1);
		during = await page.evaluate(() => document.querySelector(".stage")?.dataset.pictures === "true");
		const now = await page.evaluate((wanted) => window.__decksBoards?.().find((one) => one.path === wanted)?.rect, path);
		const shot = await page.screenshot({ clip: { x: now.x + now.width * 0.3, y: now.y + now.height * 0.3, width: Math.max(8, now.width * 0.4), height: Math.max(8, now.height * 0.4) } });
		spread = await page.evaluate(async (b64) => {
			const img = new Image();
			img.src = `data:image/png;base64,${b64}`;
			await img.decode();
			const c = document.createElement("canvas");
			c.width = img.width; c.height = img.height;
			const g = c.getContext("2d");
			g.drawImage(img, 0, 0);
			const d = g.getImageData(0, 0, c.width, c.height).data;
			let lo = 255, hi = 0;
			for (let i = 0; i < d.length; i += 4) { const v = (d[i] + d[i + 1] + d[i + 2]) / 3; lo = Math.min(lo, v); hi = Math.max(hi, v); }
			return hi - lo;
		}, shot.toString("base64"));
		await page.screenshot({ path: "/tmp/livedoc-move.png" });
	}
	say("not selected, it moves as a card with an icon and its name", !!rect && unselected && during && spread > 40, JSON.stringify({ unselected, during, spread }));
}

await browser.close();
