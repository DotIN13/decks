import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Deck } from "../deck/loader.ts";
import { inBoardFolder, relink } from "../deck/stage-boards.ts";
import { isolationNote } from "./context.ts";
import { IsolatedView } from "./isolation.ts";

/*
 * Isolated mode against real directories: the stage keeps its own copies of its boards, and the
 * agent works on those in a temporary folder. Each case is a way work could be lost, or an
 * original written, between the folder, the stage's copies and the deck.
 */

const LOCAL = "stages/mine/boards";

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "decks-isolation-test-"));
	const deck = join(root, "data", "decks");
	mkdirSync(join(deck, "boards"), { recursive: true });
	mkdirSync(join(deck, LOCAL), { recursive: true });
	mkdirSync(join(deck, "lib"), { recursive: true });
	mkdirSync(join(deck, "assets"), { recursive: true });
	writeFileSync(join(deck, "boards", "on.html"), "ORIGINAL");
	writeFileSync(join(deck, LOCAL, "on.html"), '<img src="../../../assets/pic.png">COPY');
	writeFileSync(join(deck, "boards", "off.html"), "OFF");
	writeFileSync(join(deck, "assets", "pic.png"), "PNG");
	writeFileSync(join(deck, "assets", "other.png"), "OTHER");
	writeFileSync(join(deck, "lib", "board.css"), "CSS");
	writeFileSync(join(deck, "stages", "mine", "stage.pen"), "{}");
	const boards = [`${LOCAL}/on.html`];
	const adopted: string[] = [];
	const view = new IsolatedView({
		root: join(root, "tmp", "agent"),
		deck,
		boards: () => boards,
		folder: () => LOCAL,
		stage: () => "mine",
		adopt: (path) => {
			adopted.push(path);
			if (!boards.includes(path)) boards.push(path);
		},
		notice: () => undefined,
	});
	return { deck, boards, adopted, view, done: () => rmSync(root, { recursive: true, force: true }) };
}

/** Move a file's clock on, so a change is visible to a comparison of modification times. */
const later = (file: string, seconds = 5) => {
	const at = new Date(Date.now() + seconds * 1000);
	utimesSync(file, at, at);
};

test("a board moved into a stage's folder has its relative links pointed two levels further up", () => {
	const html = '<link rel="stylesheet" href="../lib/board.css"><img src="../assets/a.png"><a href="other.html">x</a><style>a{background:url(../assets/b.png)}</style>';
	const moved = relink(html, "boards", LOCAL);
	assert.match(moved, /href="\.\.\/\.\.\/\.\.\/lib\/board\.css"/);
	assert.match(moved, /src="\.\.\/\.\.\/\.\.\/assets\/a\.png"/);
	assert.match(moved, /url\(\.\.\/\.\.\/\.\.\/assets\/b\.png\)/);
	assert.match(moved, /href="other\.html"/);
	assert.equal(relink(html, "boards", "boards"), html);
});

test("the deck lists a stage's own boards beside the deck's", () => {
	const { deck, done } = fixture();
	try {
		const paths = Deck.open(deck).boards.map((board) => board.path);
		assert.ok(paths.includes("boards/on.html"));
		assert.ok(paths.includes(`${LOCAL}/on.html`));
		assert.ok(inBoardFolder(`${LOCAL}/on.html`) && inBoardFolder("boards/on.html") && !inBoardFolder("stages/mine/stage.pen"));
	} finally {
		done();
	}
});

test("the folder holds the stage's boards at their deck paths, its drawing and their assets, and nothing else", () => {
	const { view, done } = fixture();
	try {
		view.sync();
		assert.equal(readFileSync(join(view.dir, LOCAL, "on.html"), "utf8"), '<img src="../../../assets/pic.png">COPY');
		assert.equal(readFileSync(join(view.dir, "stages", "mine", "stage.pen"), "utf8"), "{}");
		assert.ok(existsSync(join(view.dir, "assets", "pic.png")));
		assert.ok(!existsSync(join(view.dir, "boards")));
		assert.ok(!existsSync(join(view.dir, "assets", "other.png")));
		assert.equal(readFileSync(join(view.dir, "lib", "board.css"), "utf8"), "CSS");
	} finally {
		done();
	}
});

test("the agent's edit reaches the stage's copy, the person's edit reaches the folder, and the original is never written", () => {
	const { deck, view, done } = fixture();
	try {
		view.sync();
		writeFileSync(join(view.dir, LOCAL, "on.html"), "AGENT");
		later(join(view.dir, LOCAL, "on.html"));
		view.sync();
		assert.equal(readFileSync(join(deck, LOCAL, "on.html"), "utf8"), "AGENT");
		writeFileSync(join(deck, LOCAL, "on.html"), "PERSON");
		later(join(deck, LOCAL, "on.html"), 10);
		view.sync();
		assert.equal(readFileSync(join(view.dir, LOCAL, "on.html"), "utf8"), "PERSON");
		assert.equal(readFileSync(join(deck, "boards", "on.html"), "utf8"), "ORIGINAL");
	} finally {
		done();
	}
});

test("the drawing and the assets are copied in only", () => {
	const { deck, view, done } = fixture();
	try {
		view.sync();
		writeFileSync(join(view.dir, "assets", "pic.png"), "CHANGED");
		writeFileSync(join(view.dir, "stages", "mine", "stage.pen"), '{"changed":true}');
		later(join(view.dir, "assets", "pic.png"));
		later(join(view.dir, "stages", "mine", "stage.pen"));
		view.sync();
		assert.equal(readFileSync(join(deck, "assets", "pic.png"), "utf8"), "PNG");
		assert.equal(readFileSync(join(deck, "stages", "mine", "stage.pen"), "utf8"), "{}");
	} finally {
		done();
	}
});

test("a board the agent writes joins the stage's folder and the stage, never the deck's boards/", () => {
	const { deck, boards, adopted, view, done } = fixture();
	try {
		view.sync();
		writeFileSync(join(view.dir, LOCAL, "made.html"), "MADE");
		mkdirSync(join(view.dir, "boards"), { recursive: true });
		writeFileSync(join(view.dir, "boards", "off.html"), "MINE");
		view.sync();
		assert.deepEqual(adopted.sort(), [`${LOCAL}/made.html`, `${LOCAL}/off.html`]);
		assert.equal(readFileSync(join(deck, LOCAL, "made.html"), "utf8"), "MADE");
		assert.equal(readFileSync(join(deck, LOCAL, "off.html"), "utf8"), "MINE");
		assert.equal(readFileSync(join(deck, "boards", "off.html"), "utf8"), "OFF");
		assert.ok(existsSync(join(view.dir, LOCAL, "off.html")), "moved in the folder too, so the paths match");
		boards.splice(boards.indexOf(`${LOCAL}/on.html`), 1);
		view.sync();
		assert.ok(!existsSync(join(view.dir, LOCAL, "on.html")));
		assert.ok(existsSync(join(deck, LOCAL, "on.html")), "leaving the stage never deletes the stage's copy");
	} finally {
		done();
	}
});

test("closing carries the last edit into the stage's copy and removes the folder", () => {
	const { deck, view, done } = fixture();
	try {
		view.open();
		writeFileSync(join(view.dir, LOCAL, "on.html"), "LAST");
		later(join(view.dir, LOCAL, "on.html"));
		view.close();
		assert.equal(readFileSync(join(deck, LOCAL, "on.html"), "utf8"), "LAST");
		assert.equal(readFileSync(join(deck, "boards", "on.html"), "utf8"), "ORIGINAL");
		assert.ok(!existsSync(view.dir));
	} finally {
		done();
	}
});

test("the instructions name the folder, the boards, and the data folder to leave alone", () => {
	const text = isolationNote({ dir: "/tmp/decks-isolation/a", data: "/home/decks/data" }, [`${LOCAL}/on.html`]);
	assert.match(text, /\/tmp\/decks-isolation\/a/);
	assert.match(text, /stages\/mine\/boards\/on\.html/);
	assert.match(text, /Do not read, list, search or change the Decks data in `\/home\/decks\/data`/);
});
