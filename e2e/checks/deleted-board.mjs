/**
 * A deleted board leaves every agent's context with it (DESIGN §2).
 *
 * One dead path was enough to empty the rail *and* the canvas: the rail resolves held
 * paths against the deck and the canvas filters the deck by what is in play, and because
 * the context was not empty the whole-deck fallback stayed out of it. The deck looked
 * deleted.
 */
import { rmSync } from "node:fs";
import { boardPath, deckState, emptyCanvas, newAgent, open, openAllBoards, say, settle, socket, write } from "../harness.mjs";

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
	await newAgent(page);
	await settle(page, 1200);
	await page.mouse.move(800, 500);
	// A fresh agent holds nothing, so nothing is on the canvas to begin with.
	await emptyCanvas(page);

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
	/*
	 * What must recover is the *rail*.
	 *
	 * An empty canvas here is correct now — the agent held one board and it is gone, so it
	 * holds nothing and puts nothing in play. The bug this check exists for is the other
	 * half: a dead path left in the context made the rail resolve to nothing as well, so
	 * the deck itself looked deleted, and because the context was not empty the rail's
	 * whole-deck fallback did not fire either. This asserted the canvas before, which is
	 * the half that is no longer a fault.
	 *
	 * And the fallback is gone with the panel split, so the surface that proves the deck
	 * survived is the all-canvases modal: an empty *context* panel is now the correct answer
	 * to "the agent held one board and it is gone", and it would prove nothing about whether
	 * the other boards are still there.
	 */
	await openAllBoards(page);
	/*
	 * Waited on the ghost's *absence*, not on a count.
	 *
	 * The deck's own board list is fetched after this rather than before: read too early it
	 * still holds the ghost — the file was removed a moment ago and the server has not been
	 * told yet — so a count taken from it is a target the modal can never reach.
	 */
	await page.waitForFunction(
		() => {
			const items = [...document.querySelectorAll(".all-boards .rail-item .file")].map((n) => n.textContent);
			return items.length > 0 && !items.includes("boards/ghost.html");
		},
		null,
		{ timeout: 15000 },
	);
	const deck = await deckState();

	const after = await page.evaluate(() => [...document.querySelectorAll(".board-node")].map((n) => n.dataset.path).sort());
	const listed = await page.evaluate(() => [...document.querySelectorAll(".all-boards .rail-item .file")].map((n) => n.textContent).sort());
	say("the agent holds nothing, so the canvas is empty", after.length === 0, after.join(" ") || "(empty)");
	say("the deck itself is intact, without the ghost in it",
		listed.join() === deck.boards.map((b) => b.path).sort().join(), listed.join(" "));
	const pruned = link.last("context.changed");
	say("the server published the prune", Boolean(pruned) && !pruned.boards.includes("boards/ghost.html"), `boards=[${(pruned?.boards ?? []).join(" ")}]`);
	await page.keyboard.press("Escape");
	await settle(page, 250);

	/*
	 * A second page must agree — the server pruned it, not just this client.
	 *
	 * Read off the deck rather than the canvas: a fresh load's focused agent holds nothing,
	 * so its canvas is legitimately empty and would prove nothing either way.
	 */
	const fresh = await browser.newPage({ viewport: { width: 1200, height: 800 } });
	await fresh.goto(page.url(), { waitUntil: "load" });
	await fresh.waitForSelector(".composer textarea", { timeout: 15000 });
	await openAllBoards(fresh);
	await fresh.waitForSelector(".all-boards .rail-item", { timeout: 15000 });
	const reloaded = await fresh.evaluate(() => [...document.querySelectorAll(".all-boards .rail-item .file")].map((n) => n.textContent));
	say(
		"a fresh load agrees",
		reloaded.length > 0 && !reloaded.includes("boards/ghost.html"),
		reloaded.join(" ") || "(nothing)",
	);

	say("no page errors", errors.length === 0, errors.join(" | "));
} finally {
	rmSync(ghost, { force: true });
	link.close();
	await browser.close();
}
