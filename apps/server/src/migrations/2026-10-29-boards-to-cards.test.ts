import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { boardToCard, migrated, migrateBoardsToCards, notACard, restyle } from "./2026-10-29-boards-to-cards.ts";

const BOARD = `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<title>Sales rose a fifth</title>
	<meta name="board" content='{"w":1000,"bg":"plain"}' />
	<link rel="stylesheet" href="../lib/board.css" />
	<style>.board .doc { padding: 20px } body { margin: 0 } :root { --x: 1 }</style>
</head>
<body class="board">
	<div class="doc"><h1>Sales rose a fifth</h1><img src="../files/a.png" /><a href="next.html#top">next</a><a href="gone.html">gone</a>
	<button data-eval="pick" data-value="yes">Yes</button><div data-embed="../files/paper.pdf" data-pages="1-2"></div></div>
	<script type="text/decks-eval" data-for="pick">await stage.send("Shard", { task: event.value });</script>
	<script>setInterval(() => { document.getElementById("t").textContent = "../files/x.json"; }, 1000);</script>
	<script src="../lib/board.js"></script>
</body>
</html>`;

test("a board's page becomes a card: styles for its root, scripts as modules scoped to it, buttons wired, addresses one folder deeper", () => {
	const card = boardToCard(BOARD, new Map([["next.html", "next"]]), { h: 640 });
	assert.match(card, /<title>Sales rose a fifth<\/title>/);
	assert.match(card, /<meta name="board" content='\{"w":1000,"bg":"plain","h":640\}' \/>/);
	assert.doesNotMatch(card, /board\.css|board\.js|<body|<head/);
	assert.match(card, /\.card-body \{ margin: 0 \} :host \{ --x: 1 \}/);
	assert.match(card, /src="\.\.\/\.\.\/files\/a\.png"/, "one folder deeper");
	assert.match(card, /href="\.\.\/next\/index\.html#top"/, "a board that became a card");
	assert.match(card, /href="\.\.\/\.\.\/boards\/gone\.html"/, "a board that stayed");
	assert.match(card, /export default async function \(card\) \{\n\tconst document = card\.document;\n\tconst setInterval = /, "timers stop with the card");
	assert.match(card, /card\.file\("\.\.\/\.\.\/files\/x\.json"\)/, "an address a script names is read against the card");
	assert.match(card, /const blocksOf = \(card\) => \(\{\n\t"pick": async \(stage, event\) => \{\nawait stage\.send/);
	assert.match(card, /send: "agent\.queue"/, "old names mapped");
	assert.doesNotMatch(card, /text\/decks-eval/);
	assert.doesNotMatch(card, /data-embed|paper\.pdf/, "an embedded file is dropped");
});

test("pages that are not a board's are told apart", () => {
	assert.equal(notACard(BOARD), undefined);
	assert.equal(notACard(`<body class="board"><div class="live" data-live="web"></div></body>`), "its page is the shared Chrome tab");
	assert.equal(notACard(`<body><p>a page</p></body>`), "its page is not a board's");
	assert.equal(restyle("body.board .doc{}"), ".card-body .doc{}");
});

test("the migration writes the cards, rewrites the drawing, removes the boards it converted, and runs once", () => {
	const deck = mkdtempSync(join(tmpdir(), "decks-boards-cards-"));
	try {
		const canvas = join(deck, "canvases", "plan");
		mkdirSync(join(canvas, "boards"), { recursive: true });
		mkdirSync(join(canvas, "cards", "next"), { recursive: true });
		writeFileSync(join(canvas, "cards", "next", "index.html"), "<p>an existing card</p>");
		writeFileSync(join(canvas, "boards", "sales.html"), BOARD);
		writeFileSync(join(canvas, "boards", "next.html"), BOARD);
		writeFileSync(join(canvas, "boards", "tab.html"), `<body class="board"><div class="live" data-live="web"></div></body>`);
		const board = (id: string, path: string) => ({ type: "browser", id, x: 0, y: 0, width: 1000, height: 600, url: path, metadata: { type: "decks.board", path } });
		writeFileSync(join(canvas, "canvas.pen"), JSON.stringify({ version: "2.14", children: [board("s", "boards/sales.html"), { type: "frame", id: "f", children: [board("n", "canvases/plan/boards/next.html")] }, board("t", "boards/tab.html")] }, null, "\t"));
		const { ran, backup, plan } = migrateBoardsToCards(deck);
		assert.ok(ran && backup && existsSync(join(deck, backup)));
		assert.deepEqual(plan.canvases[0]!.kept, [{ board: "boards/tab.html", why: "its page is the shared Chrome tab" }]);
		const kids = (JSON.parse(readFileSync(join(canvas, "canvas.pen"), "utf8")) as { children: Array<{ metadata?: unknown; url?: unknown; children?: Array<{ metadata?: unknown }> }> }).children;
		assert.deepEqual(kids[0]!.metadata, { type: "decks.card", path: "cards/sales/index.html" });
		assert.equal(kids[0]!.url, "cards/sales/index.html");
		assert.deepEqual(kids[1]!.children![0]!.metadata, { type: "decks.card", path: "cards/next-2/index.html" }, "inside a frame, and clear of a card already there");
		assert.deepEqual(kids[2]!.metadata, { type: "decks.board", path: "boards/tab.html" });
		assert.match(readFileSync(join(canvas, "cards", "sales", "index.html"), "utf8"), /href="\.\.\/next-2\/index\.html#top"/);
		assert.equal(readFileSync(join(canvas, "cards", "next", "index.html"), "utf8"), "<p>an existing card</p>");
		assert.ok(!existsSync(join(canvas, "boards", "sales.html")) && existsSync(join(canvas, "boards", "tab.html")));
		assert.ok(migrated(deck));
		assert.equal(migrateBoardsToCards(deck).ran, false, "once");
	} finally {
		rmSync(deck, { recursive: true, force: true });
	}
});
