/**
 * An app on the canvas: a folder in the deck's `apps/` (`server/apps/service.ts`), served at
 * `/app/<name>/`, shown as a board that is the app (`boards/apps/<name>.html`, `lib/live-app.js`).
 *
 * Needs no model: the app is written the way an agent's `stage.apps.create` writes one — a
 * starter's files and the app's board — and played onto the stage over the wire. A static app,
 * because a server app is deliberately not started for a browser that says it is automated
 * (`navigator.webdriver`): taking a board's picture must never start a process.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deckState, flyToBoard, open, resetStage, say, settle, socket } from "../harness.mjs";

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
const folder = join(deck.path, "apps", "e2e-counter");
mkdirSync(folder, { recursive: true });
writeFileSync(join(folder, "app.json"), JSON.stringify({ title: "E2E counter", kind: "static" }));
writeFileSync(join(folder, "index.html"), `<!doctype html><html><body><h1>E2E counter</h1><button id="press">Pressed 0</button>
<script>let n = 0; document.getElementById("press").onclick = (e) => (e.target.textContent = "Pressed " + ++n);</script></body></html>`);
mkdirSync(join(deck.path, "boards", "apps"), { recursive: true });
writeFileSync(
	join(deck.path, "boards", "apps", "e2e-counter.html"),
	`<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>E2E counter</title>
		<meta name="board" content='{"w":700,"h":420,"bg":"plain"}' />
		<link rel="stylesheet" href="../../lib/board.css" />
	</head>
	<body class="board">
		<div class="live" data-id="app" data-live="app" data-app="e2e-counter" style="left: 0; top: 0; right: 0; bottom: 0"></div>
		<script src="../../lib/board.js"></script>
	</body>
</html>
`,
);

const listed = await until(async () => (await (await fetch(`${process.env.DECKS_E2E_API ?? "http://127.0.0.1:4329"}/api/apps`)).json()).apps.find((one) => one.name === "e2e-counter"));
say("the server lists the app, ready to serve", listed?.status === "running", listed?.status);

const link = await socket();
await until(() => link.last("agents")?.focused);
link.send({ type: "board.play", path: "boards/apps/e2e-counter.html" });
await new Promise((resolve) => setTimeout(resolve, 600));
link.close();

const { browser, page } = await open({ width: 1400, height: 900, boards: false });
await settle(page, 1500);
await flyToBoard(page, "boards/apps/e2e-counter.html");
const board = page.frameLocator('iframe[data-path="boards/apps/e2e-counter.html"]');
const found = await until(() => page.locator('iframe[data-path="boards/apps/e2e-counter.html"]').count(), 15000);
say("the app's board is on the canvas", found > 0);

if (found) {
	const bar = await board.locator(".app-bar").innerText({ timeout: 10000 }).catch(() => "");
	say("its bar says the app is running, and what it is", /Running/.test(bar) && /E2E counter/.test(bar) && /static app/.test(bar), bar.replace(/\n/g, " "));
	const app = board.frameLocator(".live.app iframe");
	const heading = await app.locator("h1").innerText({ timeout: 10000 }).catch(() => "");
	say("under the bar is the app itself, from /app/e2e-counter/", heading === "E2E counter", heading);
	await app.locator("#press").click({ timeout: 5000 }).catch(() => {});
	await app.locator("#press").click({ timeout: 5000 }).catch(() => {});
	say("and it works there", (await app.locator("#press").innerText().catch(() => "")) === "Pressed 2");
	const open_ = await board.locator(".app-bar a").getAttribute("href").catch(() => "");
	say("Open goes to the app's own address", /\/app\/e2e-counter\/$/.test(open_ ?? ""), open_);
	/*
	 * The canvas pans and zooms over the app, as over any board: the app's own page passes the wheel
	 * on (`lib/live-app.js`), where it used to keep it and the canvas stood still under the pointer.
	 */
	const camera = () => page.evaluate(() => { const m = new DOMMatrix(getComputedStyle(document.querySelector(".world")).transform); return { x: m.e, y: m.f, zoom: m.a }; });
	const area = await page.locator('iframe[data-path="boards/apps/e2e-counter.html"]').boundingBox();
	await page.mouse.move(area.x + area.width / 2, area.y + area.height * 0.7);
	const before = await camera();
	await page.mouse.wheel(0, 120);
	await page.waitForTimeout(500);
	const panned = await camera();
	say("a scroll over the app pans the canvas", panned.y !== before.y, `${Math.round(before.y)} -> ${Math.round(panned.y)}`);
	await page.keyboard.down("Control");
	await page.mouse.wheel(0, -100);
	await page.keyboard.up("Control");
	await page.waitForTimeout(700);
	const zoomed = await camera();
	say("and a pinch over it zooms the canvas", zoomed.zoom !== panned.zoom, `${panned.zoom.toFixed(3)} -> ${zoomed.zoom.toFixed(3)}`);
	// A middle-drag over the app pans the canvas by as much as the mouse moved, as over a board.
	const there = await page.locator('iframe[data-path="boards/apps/e2e-counter.html"]').boundingBox();
	const from = { x: there.x + there.width / 2, y: there.y + there.height * 0.7 };
	const still = await camera();
	await page.mouse.move(from.x, from.y);
	await page.mouse.down({ button: "middle" });
	for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + i * 10, from.y + i * 5);
	await page.mouse.up({ button: "middle" });
	await page.waitForTimeout(400);
	const dragged = await camera();
	say("a middle-drag over the app pans the canvas with the mouse", Math.round(dragged.x - still.x) === 80 && Math.round(dragged.y - still.y) === 40, `${Math.round(dragged.x - still.x)}, ${Math.round(dragged.y - still.y)}`);
	// Space typed into a field in the app is a space, not the canvas's pan key.
	await app.locator("body").evaluate((body) => body.insertAdjacentHTML("beforeend", '<input id="words" />'));
	await app.locator("#words").click();
	await page.keyboard.type("a b");
	say("Space in a field of the app types a space", (await app.locator("#words").inputValue()) === "a b");
}

await browser.close();

// Off the stage and out of the deck again, so the checks after this one find the canvas as they expect.
const tidy = await socket();
await until(() => tidy.last("agents")?.focused);
tidy.send({ type: "board.hide", path: "boards/apps/e2e-counter.html" });
await new Promise((resolve) => setTimeout(resolve, 400));
tidy.close();
rmSync(join(deck.path, "boards", "apps", "e2e-counter.html"), { force: true });
rmSync(folder, { recursive: true, force: true });
