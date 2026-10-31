import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyBoardInto } from "./copy-in.ts";

test("a card placed from another canvas comes with its whole folder, into cards/, as a card", () => {
	const deck = mkdtempSync(join(tmpdir(), "copy-in-"));
	try {
		mkdirSync(join(deck, "canvases/a/cards/sales"), { recursive: true });
		writeFileSync(join(deck, "canvases/a/cards/sales/index.html"), "<h1>Sales</h1><script type=module src=chart.js></script>");
		writeFileSync(join(deck, "canvases/a/cards/sales/chart.js"), "export default () => {};");
		const copy = copyBoardInto(deck, "canvases/a/cards/sales/index.html", "b");
		assert.equal(copy, "canvases/b/cards/sales/index.html");
		assert.equal(readFileSync(join(deck, "canvases/b/cards/sales/chart.js"), "utf8"), "export default () => {};");
		assert.ok(!existsSync(join(deck, "canvases/b/boards")), "no board copy");
		assert.equal(copyBoardInto(deck, "canvases/a/cards/sales/index.html", "b"), "canvases/b/cards/sales-2/index.html", "the next free name");
	} finally {
		rmSync(deck, { recursive: true, force: true });
	}
});

test("a library board placed on an own canvas lands as a card, its links one folder deeper; on a friend's canvas, and a page no converter reads, it stays a board", () => {
	const deck = mkdtempSync(join(tmpdir(), "copy-in-"));
	try {
		mkdirSync(join(deck, "boards"), { recursive: true });
		mkdirSync(join(deck, "assets"), { recursive: true });
		writeFileSync(join(deck, "assets/a.png"), "png");
		writeFileSync(join(deck, "boards/sales.html"), `<html><head><title>Sales</title><link rel="stylesheet" href="../lib/board.css"></head><body class="board"><div class="doc"><img src="../assets/a.png"></div><script src="../lib/board.js"></script></body></html>`);
		writeFileSync(join(deck, "boards/site.html"), `<body><iframe src="https://example.com"></iframe></body>`);
		const copy = copyBoardInto(deck, "boards/sales.html", "b");
		assert.equal(copy, "canvases/b/cards/sales/index.html");
		const card = readFileSync(join(deck, copy), "utf8");
		assert.match(card, /src="\.\.\/\.\.\/assets\/a\.png"/);
		assert.doesNotMatch(card, /board\.js|<body/);
		assert.ok(!existsSync(join(deck, "canvases/b/boards/sales.html")), "no board copy");
		assert.equal(copyBoardInto(deck, "boards/sales.html", "b"), "canvases/b/cards/sales-2/index.html");
		assert.equal(copyBoardInto(deck, "boards/site.html", "b"), "canvases/b/boards/site.html", "a page that is not a board's");
		assert.equal(copyBoardInto(deck, "boards/sales.html", "shared/ada/old"), "shared/canvases/ada/old/boards/sales.html", "a friend's canvas keeps boards");
	} finally {
		rmSync(deck, { recursive: true, force: true });
	}
});
