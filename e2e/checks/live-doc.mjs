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
import { API, asPerson, deckState, flyToBoard, liveZoom, open, rest, resetStage, say, selectBoard, settle, socket, stagePath } from "../harness.mjs";

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
/* The stage's own list: below the live zoom a board is drawn on the sheet and has no frame until it is selected. */
const docPath = await until(() => page.evaluate(() => (window.__decksBoards?.() ?? []).find((one) => one.path.endsWith("e2e-doc.html"))?.path), 15000);
const found = docPath ? 1 : 0;
say("the document board is on the canvas", found > 0, String(docPath));

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
	const path = docPath;
	// The camera to it through the API (as `board-eval.mjs` does), then selected: a fresh deck opens with it off to the side.
	for (let i = 0; i < 10; i++) {
		const focused = await fetch(`${API}/api/v1/view.focus`, { method: "POST", headers: { "content-type": "application/json", ...(await asPerson()) }, body: JSON.stringify({ args: [path] }) }).then((r) => r.json());
		if (!focused.value?.deferred) break;
		await settle(page, 1000);
	}
	await rest(page).catch(() => {});
	await selectBoard(page, path);
	// `1` frames the selected board: selecting may have fitted the whole canvas to find it.
	await page.keyboard.press("1");
	await rest(page).catch(() => {});
	// Zoomed in far enough that the board's page is live and takes the pointer.
	await liveZoom(page);
	await settle(page, 800);
	const board = page.frameLocator(node).first();
	const shown = await until(async () => (await board.locator("body").innerText().catch(() => "")).includes("Hello from the file"), 15000);
	say("the file's words show in the board, not Opening…", shown, shown ? "" : (await board.locator("body").innerText().catch(() => "")).slice(0, 120));

	if (shown) {
		const words = board.getByText("Hello from the file.");
		/*
		 * Pressed where it is on screen rather than with `locator.click()`: Playwright scrolls an element
		 * into view first, and the stage is a native scroll container now, so that scroll panned the
		 * camera ~900px and the press landed on the tool column instead of the words.
		 */
		const at = await words.boundingBox();
		if (at) await page.mouse.click(at.x + Math.min(at.width / 2, 40), at.y + at.height / 2);
		/*
		 * The caret to the end of those words, set in the page: End is not "end of line" on a Mac (it
		 * scrolls), and the press lands mid-sentence, so typing went into the middle of "Hello".
		 */
		await words.evaluate((el) => {
			const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
			let last = null;
			while (walker.nextNode()) last = walker.currentNode;
			if (!last) return;
			const range = el.ownerDocument.createRange();
			range.setStart(last, last.textContent.length);
			range.collapse(true);
			const selection = el.ownerDocument.getSelection();
			selection.removeAllRanges();
			selection.addRange(range);
		});
		await page.keyboard.type(" Typed here.");
		const typed = await until(() => files().some((file) => readFileSync(file, "utf8").includes("Typed here.")), 10000);
		say("words typed in the board reach the file", typed, files().join(", "));

		for (const file of files()) writeFileSync(file, readFileSync(file, "utf8").replace("Hello from the file.", "Changed on disk."));
		const followed = await until(async () => (await board.locator("body").innerText().catch(() => "")).includes("Changed on disk"), 10000);
		say("the file changed on disk shows in the board", followed);
	}

	/*
	 * Selected, a document keeps its page while the camera moves: pages change only when the camera
	 * rests, and a document's picture is not the page being typed in. A pinch (a wheel with Control),
	 * because over a page a plain wheel scrolls the page, not the camera; `data-moving` says it moved.
	 */
	await page.locator(".v3-zoom-value").first().waitFor({ timeout: 3000 }).catch(() => {});
	// Selected for certain: the press that put the caret in it sometimes lands before the selection has settled, and leaves it unselected.
	const isSelected = () => page.evaluate((n) => document.querySelector(n)?.closest(".board-node")?.dataset.selected === "true", node);
	if (!(await until(isSelected, 2000))) await selectBoard(page, path);
	const box = await page.locator(node).first().boundingBox();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	const seen = [];
	await page.keyboard.down("Control");
	for (let i = 0; i < 6; i++) {
		await page.mouse.wheel(0, 20);
		await page.waitForTimeout(30);
		seen.push(await page.evaluate((n) => {
			const frame = document.querySelector(n);
			return { moving: document.querySelector(".stage")?.dataset.moving === "true", shown: !!frame && getComputedStyle(frame).visibility !== "hidden", selected: frame?.closest(".board-node")?.dataset.selected === "true" };
		}, node));
	}
	await page.keyboard.up("Control");
	const moving = seen.filter((one) => one.moving);
	say("selected, its page stays up while the camera moves", moving.length > 0 && moving.every((one) => one.shown), JSON.stringify(seen));
	await settle(page, 600);

	/*
	 * Not selected and under the live zoom, it is drawn as a card with its icon and name
	 * (`live-placeholder.ts`), where the other boards are drawn as their pictures: a picture of a
	 * document is its page before the file came, and a fresh deck has none. Read as pixels, during a
	 * move: the card's middle has the icon and the name in it, where an empty picture is one flat colour.
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
		// No page for it: below the live zoom only the selected board keeps one.
		during = await page.evaluate((n) => { const frame = document.querySelector(n); return !frame || getComputedStyle(frame).visibility === "hidden"; }, node);
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

/* Any board, selected, keeps its page through a move: an ordinary one as well as a document. */
const plan = await stagePath(page, "boards/plan.html");
await flyToBoard(page, plan);
await liveZoom(page);
await selectBoard(page, plan);
await settle(page, 500);
const planFrame = `iframe[data-path="${plan}"]`;
const planBox = await page.locator(planFrame).boundingBox();
const kept = [];
if (planBox) {
	// A pinch (a wheel with Control): over a page a plain wheel scrolls the page, not the camera.
	await page.mouse.move(planBox.x + planBox.width / 2, planBox.y + planBox.height / 2);
	await page.keyboard.down("Control");
	for (let i = 0; i < 6; i++) {
		await page.mouse.wheel(0, 20);
		await page.waitForTimeout(30);
		kept.push(await page.evaluate((n) => ({ moving: document.querySelector(".stage")?.dataset.moving === "true", shown: getComputedStyle(document.querySelector(n)).visibility !== "hidden" }), planFrame));
	}
	await page.keyboard.up("Control");
}
const movingPlan = kept.filter((one) => one.moving);
say("any board, selected, keeps its page while the camera moves", movingPlan.length > 0 && movingPlan.every((one) => one.shown), JSON.stringify(kept));

await browser.close();
