import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { migrated, migrateBoardLeftovers } from "./2026-10-30-board-leftovers.ts";
import { notACard } from "./2026-10-29-boards-to-cards.ts";
import { revisionOf } from "../deck/loader.ts";
import { thumbName } from "../pictures/ladder.ts";

const FILE_BOARD = `<!doctype html><html><head><title>paper.pdf</title><meta name="board" content='{"w":800,"h":1000,"bg":"plain"}' /></head>
<body class="board"><div data-id="file" data-embed="../files/paper.pdf" data-bare></div><script src="../../lib/board.js"></script></body></html>`;
const WEB_BOARD = `<body class="board"><div class="live" data-live="web"></div></body>`;
const TALKS_ABOUT_DOCS = `<html><head><title>Docs are items</title></head><body class="board"><div class="doc"><p>A board with <code>data-live="doc"</code>.</p><img src="../files/a.png"></div></body></html>`;
const IFRAME_PAGE = `<html><head><title>A framed site</title></head><body><iframe src="https://example.com"></iframe></body></html>`;
const DOC_BOARD = `<div class="live" data-live="doc" data-path="../files/notes.md"></div>`;

function write(deck: string, path: string, text: string | Buffer) {
	mkdirSync(dirname(join(deck, path)), { recursive: true });
	writeFileSync(join(deck, path), text);
}

const board = (id: string, path: string, x = 0) => ({ type: "browser", id, x, y: 20, width: 800, height: 600, url: path, metadata: { type: "decks.board", path } });

test("file boards are notACard, so boards-to-cards leaves them for the leftovers; data-live in a page's words is not a live box", () => {
	assert.equal(notACard(FILE_BOARD), "its page is one file");
	assert.equal(notACard(TALKS_ABOUT_DOCS), undefined);
	assert.equal(notACard(WEB_BOARD), "its page is the shared Chrome tab");
});

test("every board left on an own canvas is taken by what its page is, the board files nobody names go, a friend's canvas and the library stay, and it runs once", () => {
	const deck = mkdtempSync(join(tmpdir(), "decks-board-leftovers-"));
	try {
		write(deck, "canvases/plan/files/paper.pdf", "%PDF-1.4 not really");
		write(deck, "canvases/plan/boards/paper.html", FILE_BOARD);
		write(deck, "canvases/plan/boards/your-chrome.html", WEB_BOARD);
		write(deck, "canvases/plan/boards/docs.html", TALKS_ABOUT_DOCS);
		write(deck, "canvases/plan/boards/site.html", IFRAME_PAGE);
		write(deck, "canvases/plan/boards/notes.html", DOC_BOARD);
		write(deck, "canvases/plan/boards/left-by-docs-and-apps.html", `<div data-live="app" data-app="review"></div>`);
		write(deck, "canvases/plan/boards/never-placed.html", `<body class="board"><h1>Copied in, never placed</h1></body>`);
		write(deck, "canvases/plan/boards/linked.html", `<body class="board"><h1>A card links here</h1></body>`);
		write(deck, "canvases/plan/boards/theme.css", "body { color: red }");
		write(deck, "canvases/plan/cards/old/index.html", `<a href="../../boards/linked.html">the old one</a>`);
		// The iframe page's last picture.
		write(deck, `.decks/thumbs/${thumbName("canvases/plan/boards/site.html", revisionOf(IFRAME_PAGE), "light", "whole")}`, Buffer.from("RIFF....WEBP"));
		const pen = { version: "2.14", children: [board("paper", "boards/paper.html"), board("web", "boards/your-chrome.html"), { type: "frame", id: "f", children: [board("docs", "boards/docs.html"), board("notes", "boards/notes.html")] }, board("site", "canvases/plan/boards/site.html"), board("ghost", "boards/gone.html"), { type: "note", id: "n", content: "hi" }] };
		write(deck, "canvases/plan/canvas.pen", JSON.stringify(pen, null, "\t"));
		// A friend's canvas and the library: never touched.
		write(deck, "shared/canvases/ada/old/boards/x.html", FILE_BOARD);
		write(deck, "shared/canvases/ada/old/canvas.pen", JSON.stringify({ children: [board("x", "boards/x.html")] }));
		write(deck, "boards/library.html", `<body class="board"><h1>Library</h1></body>`);

		const lines: string[] = [];
		const { ran, backup, report } = migrateBoardLeftovers(deck, { log: (line) => lines.push(line), now: new Date("2026-10-30T12:00:00Z"), draw: false });
		assert.ok(ran);
		assert.ok(backup && existsSync(join(deck, backup)), "backed up");
		assert.ok(report && existsSync(join(deck, report)), "a report beside it");

		const kids = (JSON.parse(readFileSync(join(deck, "canvases/plan/canvas.pen"), "utf8")) as { children: Array<Record<string, any>> }).children;
		assert.deepEqual(kids.map((one) => one.id), ["paper", "f", "site", "ghost", "n"], "the Chrome tab's board is removed");
		assert.equal(kids[0]!.type, "frame");
		assert.deepEqual(kids[0]!.metadata, { type: "decks.file", path: "files/paper.pdf" });
		assert.equal(kids[0]!.x, 0);
		assert.equal(kids[0]!.width, 320);
		assert.deepEqual(kids[1]!.children[0].metadata, { type: "decks.card", path: "cards/docs/index.html" }, "a board's page, inside a frame");
		assert.deepEqual(kids[1]!.children[1].metadata, { type: "decks.document", path: "canvases/plan/files/notes.md" }, "a document board inside a frame");
		assert.deepEqual(kids[2]!.metadata, { type: "decks.card", path: "cards/site/index.html" });
		assert.equal(kids[2]!.url, "cards/site/index.html");
		assert.deepEqual(kids[3]!.metadata, { type: "decks.board", path: "boards/gone.html" }, "a board whose file is gone is listed, not guessed at");

		assert.match(readFileSync(join(deck, "canvases/plan/cards/docs/index.html"), "utf8"), /src="\.\.\/\.\.\/files\/a\.png"/);
		const picture = readFileSync(join(deck, "canvases/plan/cards/site/index.html"), "utf8");
		assert.match(picture, /<img class="old-board" src="picture\.webp"/);
		assert.match(picture, /href="\.\.\/\.\.\/boards\/site\.html"/);
		assert.ok(existsSync(join(deck, "canvases/plan/cards/site/picture.webp")));

		const left = (name: string) => existsSync(join(deck, "canvases/plan/boards", name));
		assert.ok(left("site.html"), "a picture card's page stays, for its link");
		assert.ok(left("linked.html"), "a page a card links to stays");
		assert.ok(left("theme.css"), "only pages go");
		for (const gone of ["paper.html", "your-chrome.html", "docs.html", "notes.html", "left-by-docs-and-apps.html", "never-placed.html"]) assert.ok(!left(gone), gone);
		assert.ok(existsSync(join(deck, "shared/canvases/ada/old/boards/x.html")) && existsSync(join(deck, "boards/library.html")));

		const record = JSON.parse(readFileSync(join(deck, ".decks/migrations.json"), "utf8"))["2026-10-30-board-leftovers"];
		assert.equal(record.fileCards, 1);
		assert.equal(record.removed, 1);
		assert.equal(record.cards, 1);
		assert.equal(record.documents, 1);
		assert.equal(record.pictureCards, 1);
		assert.equal(record.kept, 1);
		assert.equal(record.deleted, 6);
		assert.deepEqual(record.notConverted, [
			{ board: "canvases/plan/boards/site.html", as: "picture", why: "its page frames another page" },
			{ board: "canvases/plan/boards/gone.html", as: "kept", why: "its file is gone" },
		]);
		assert.ok(migrated(deck));
		assert.equal(migrateBoardLeftovers(deck).ran, false, "once");
	} finally {
		rmSync(deck, { recursive: true, force: true });
	}
});

test("a deck with nothing left writes no backup and no report, and records that it ran", () => {
	const deck = mkdtempSync(join(tmpdir(), "decks-board-leftovers-none-"));
	try {
		write(deck, "canvases/plan/canvas.pen", JSON.stringify({ children: [{ type: "note", id: "n" }] }));
		const { ran, backup, report } = migrateBoardLeftovers(deck);
		assert.ok(ran && !backup && !report);
		assert.ok(migrated(deck));
	} finally {
		rmSync(deck, { recursive: true, force: true });
	}
});
