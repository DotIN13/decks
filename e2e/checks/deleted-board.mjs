/**
 * A deleted board leaves every agent's context with it (DESIGN §2).
 *
 * One dead path was enough to empty the rail *and* the canvas: the rail resolves held
 * paths against the deck and the canvas filters the deck by what is in play, and because
 * the context was not empty the whole-deck fallback stayed out of it. The deck looked
 * deleted.
 */
import { rmSync } from "node:fs";
import { boardPath, deckState, open, ready, say, settle, socket, write } from "../harness.mjs";

const ghost = await boardPath("ghost.html");
write(
	ghost,
	`<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Ghost</title>
<meta name="board" content='{"w":800,"h":600}' /><link rel="stylesheet" href="../lib/board.css" /></head>
<body class="board"><section class="card" data-id="x" style="left:40px;top:40px"><h3>Ghost</h3></section>
<script src="../lib/board.js"></script></body></html>`,
);

const link = await socket();
const { browser, page, errors } = await open({ width: 1500, height: 950 });
try {
	// A fresh agent holds nothing, so playing one board leaves it holding exactly that
	// board — the state where a deletion used to blank everything.
	await page.mouse.move(6, 480);
	await page.waitForFunction(() => document.querySelector(".side")?.dataset.open === "true", null, { timeout: 4000 });
	await page.locator('.chats .rail-head button[title="Start another agent"]').click();
	await settle(page, 1200);
	await page.mouse.move(800, 500);
	await ready(page);

	link.send({ type: "board.play", path: "boards/ghost.html" });
	await page.waitForFunction(() => document.querySelectorAll(".board-node").length === 1, null, { timeout: 8000 });
	const held = link.last("context.changed")?.boards ?? [];
	const canvas = await page.evaluate(() => [...document.querySelectorAll(".board-node")].map((n) => n.dataset.path));
	say(
		"the agent is left holding only the ghost",
		held.join() === "boards/ghost.html" && canvas.join() === "boards/ghost.html",
		`held=[${held.join(" ")}] canvas=[${canvas.join(" ")}]`,
	);

	rmSync(ghost, { force: true });
	await page.waitForFunction(() => document.querySelectorAll(".board-node").length > 1, null, { timeout: 15000 });
	await ready(page);

	const after = await page.evaluate(() => [...document.querySelectorAll(".board-node")].map((n) => n.dataset.path).sort());
	const deck = await deckState();
	say("deleting the only held board does not blank the canvas", after.length > 0, after.join(" ") || "(blank)");
	say("…it falls back to the whole deck, minus the ghost", after.join() === deck.boards.map((b) => b.path).sort().join(), after.join(" "));
	say("the rail recovers too", (await page.evaluate(() => document.querySelectorAll(".rail-item").length)) > 0);
	const pruned = link.last("context.changed");
	say("the server published the prune", Boolean(pruned) && !pruned.boards.includes("boards/ghost.html"), `boards=[${(pruned?.boards ?? []).join(" ")}]`);

	// A second page must agree — the server pruned it, not just this client.
	const fresh = await browser.newPage({ viewport: { width: 1200, height: 800 } });
	await fresh.goto(page.url(), { waitUntil: "load" });
	await fresh.waitForSelector(".board-node", { timeout: 15000 });
	const reloaded = await fresh.evaluate(() => [...document.querySelectorAll(".board-node")].map((n) => n.dataset.path));
	say("a fresh load agrees", reloaded.length > 0, reloaded.join(" ") || "(blank)");

	say("no page errors", errors.length === 0, errors.join(" | "));
} finally {
	rmSync(ghost, { force: true });
	link.close();
	await browser.close();
}
