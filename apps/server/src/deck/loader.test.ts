import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Deck } from "./loader.ts";
import { realPathOf } from "./roots.ts";

function board(title: string, w?: number, h?: number): string {
	const meta = w && h ? `<meta name="board" content='{"w":${w},"h":${h}}'>` : "";
	return `<!doctype html><html><head><title>${title}</title>${meta}</head><body class="board"></body></html>`;
}

function emptyDeck(withFile = true) {
	const root = realPathOf(mkdtempSync(join(tmpdir(), "decks-loader-")));
	mkdirSync(join(root, "boards"), { recursive: true });
	if (withFile) writeFileSync(join(root, "deck.json"), JSON.stringify({ version: 1, name: "T" }));
	return root;
}

test("an unnamed deck takes the name of the data directory it sits in", () => {
	const base = realPathOf(mkdtempSync(join(tmpdir(), "decks-name-")));
	// The shape the app actually creates: <data dir>/decks.
	const root = join(base, "my-project", "decks");
	mkdirSync(join(root, "boards"), { recursive: true });
	writeFileSync(join(root, "boards", "a.html"), board("A"));
	assert.equal(Deck.open(root).name, "my-project");

	// A dotted data directory is a convention, not a name.
	const dotted = join(base, ".decks", "decks");
	mkdirSync(join(dotted, "boards"), { recursive: true });
	writeFileSync(join(dotted, "boards", "a.html"), board("A"));
	assert.equal(Deck.open(dotted).name, "decks");

	// And deck.json always wins.
	writeFileSync(join(root, "deck.json"), JSON.stringify({ version: 1, name: "Auth work" }));
	assert.equal(Deck.open(root).name, "Auth work");
	rmSync(base, { recursive: true, force: true });
});

test("a directory of boards with no deck.json is still a deck", () => {
	const root = emptyDeck(false);
	writeFileSync(join(root, "boards", "a.html"), board("A", 800, 600));
	const deck = Deck.open(root);
	assert.equal(deck.boards.length, 1);
	assert.equal(deck.boards[0]?.title, "A");
	// Opening a deck must not write to it.
	assert.throws(() => readFileSync(join(root, "deck.json")));
	rmSync(root, { recursive: true, force: true });
});

test("boards nobody arranged get placed in rows, not on top of each other", () => {
	const root = emptyDeck();
	for (const name of ["a", "b", "c", "d"]) writeFileSync(join(root, "boards", `${name}.html`), board(name.toUpperCase(), 400, 300));
	const deck = Deck.open(root);
	const boxes = deck.boards.map((b) => ({ path: b.path, x: b.x, y: b.y, w: b.w, h: b.h }));
	for (const a of boxes) {
		for (const b of boxes) {
			if (a.path === b.path) continue;
			const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
			assert.equal(overlap, false, `${a.path} overlaps ${b.path}`);
		}
	}
	// Three to a row, so the fourth starts a new one.
	assert.equal(boxes[3]?.y! > boxes[0]?.y!, true);
	rmSync(root, { recursive: true, force: true });
});

test("a position in deck.json wins over the auto-layout, and survives a save", () => {
	const root = emptyDeck();
	writeFileSync(join(root, "boards", "a.html"), board("A", 800, 600));
	writeFileSync(join(root, "deck.json"), JSON.stringify({ version: 1, name: "T", boards: { "boards/a.html": { x: 42, y: 99 } }, mine: 1 }));
	const deck = Deck.open(root);
	assert.deepEqual([deck.boards[0]?.x, deck.boards[0]?.y], [42, 99]);

	deck.setPosition("boards/a.html", 5, 6);
	const written = JSON.parse(readFileSync(join(root, "deck.json"), "utf8"));
	assert.deepEqual(written.boards["boards/a.html"], { x: 5, y: 6 });
	assert.equal(written.mine, 1, "an unknown key survives a write");
	rmSync(root, { recursive: true, force: true });
});

test("refreshing one board keeps its position and picks up its new size", () => {
	const root = emptyDeck();
	writeFileSync(join(root, "boards", "a.html"), board("A", 800, 600));
	const deck = Deck.open(root);
	deck.setPosition("boards/a.html", 300, 400);
	const before = deck.board("boards/a.html")!.rev;

	writeFileSync(join(root, "boards", "a.html"), board("A renamed", 1000, 700));
	const refreshed = deck.refresh("boards/a.html")!;
	assert.equal(refreshed.title, "A renamed");
	assert.equal(refreshed.w, 1000);
	assert.deepEqual([refreshed.x, refreshed.y], [300, 400], "an edit does not move a board");
	assert.notEqual(refreshed.rev, before, "the revision moves when the file does");
	rmSync(root, { recursive: true, force: true });
});

test("a board that has been deleted leaves the deck", () => {
	const root = emptyDeck();
	writeFileSync(join(root, "boards", "a.html"), board("A"));
	const deck = Deck.open(root);
	rmSync(join(root, "boards", "a.html"));
	assert.equal(deck.refresh("boards/a.html"), undefined);
	assert.equal(deck.boards.length, 0);
	rmSync(root, { recursive: true, force: true });
});

test("removing a board deletes the file, forgets it, and takes its position with it", () => {
	const root = emptyDeck();
	writeFileSync(join(root, "boards", "a.html"), board("A"));
	writeFileSync(join(root, "boards", "b.html"), board("B"));
	const deck = Deck.open(root);
	deck.setPosition("boards/a.html", 40, 80);
	deck.setPosition("boards/b.html", 900, 80);

	assert.equal(deck.remove("boards/a.html"), true);
	assert.equal(existsSync(join(root, "boards", "a.html")), false, "the file is gone");
	assert.equal(deck.board("boards/a.html"), undefined);
	assert.deepEqual(deck.boards.map((one) => one.path), ["boards/b.html"]);

	const arrangement = JSON.parse(readFileSync(join(root, "deck.json"), "utf8"));
	assert.deepEqual(Object.keys(arrangement.boards), ["boards/b.html"], "a deleted board keeps no position");
	assert.deepEqual(arrangement.boards["boards/b.html"], { x: 900, y: 80 }, "and the survivor keeps its own");

	assert.equal(deck.remove("boards/a.html"), false, "removing it twice is not an error, it is nothing");
	rmSync(root, { recursive: true, force: true });
});

test("removing from a deck with no arrangement does not write one", () => {
	const root = emptyDeck(false);
	writeFileSync(join(root, "boards", "a.html"), board("A"));
	const deck = Deck.open(root);
	assert.equal(deck.remove("boards/a.html"), true);
	assert.equal(existsSync(join(root, "deck.json")), false, "opening a deck must not write to it, and neither must this");
	rmSync(root, { recursive: true, force: true });
});

test("a path that climbs out of the deck cannot be removed", () => {
	const root = emptyDeck();
	const outside = join(root, "..", `escape-${Date.now()}.html`);
	writeFileSync(outside, board("Outside"));
	const deck = Deck.open(root);
	assert.throws(() => deck.remove("../escape.html"));
	assert.throws(() => deck.remove("boards/../../escape.html"));
	assert.equal(existsSync(outside), true, "the file outside the deck is untouched");
	rmSync(outside, { force: true });
	rmSync(root, { recursive: true, force: true });
});

/*
 * Markdown used to be on the "not a board" side of this test, and now it is a board — see
 * `deck/kinds.ts`. Kept as one test rather than split, because what it is really asserting
 * has not changed: the glob walks subdirectories, skips dotfiles, and takes only the
 * extensions it knows.
 */
test("boards are found in subdirectories, and non-boards are not", () => {
	const root = emptyDeck();
	mkdirSync(join(root, "boards", "nested"), { recursive: true });
	writeFileSync(join(root, "boards", "a.html"), board("A"));
	writeFileSync(join(root, "boards", "nested", "b.htm"), board("B"));
	writeFileSync(join(root, "boards", "notes.md"), "# Notes");
	writeFileSync(join(root, "boards", "talk.slides.md"), "# One\n\n---\n\n# Two");
	writeFileSync(join(root, "boards", "readme.txt"), "not a board");
	writeFileSync(join(root, "boards", ".hidden.html"), board("H"));
	const deck = Deck.open(root);
	assert.deepEqual(
		deck.boards.map((b) => b.path),
		["boards/a.html", "boards/nested/b.htm", "boards/notes.md", "boards/talk.slides.md"],
	);
	// And each one knows what it is, which is what everything downstream keys off.
	assert.deepEqual(
		deck.boards.map((b) => b.format),
		["component", "component", "flow", "slides"],
	);
	// The title comes from the content for a flow board: a rail full of filenames is a
	// rail with nothing in it.
	assert.equal(deck.boards.find((b) => b.path === "boards/notes.md")?.title, "Notes");
	rmSync(root, { recursive: true, force: true });
});

/*
 * `resync` is what makes the deck right rather than merely quick: the watcher is a
 * promise the operating system does not quite make, so the deck has to be able to
 * answer "what is actually on disk" without one.
 */
test("resync reports what changed, what arrived and what went away — and nothing else", () => {
	const root = emptyDeck();
	writeFileSync(join(root, "boards", "a.html"), board("A", 800, 600));
	const deck = Deck.open(root);
	assert.deepEqual(deck.resync(), { changed: [], removed: [] });

	// An edit the watcher never mentioned.
	writeFileSync(join(root, "boards", "a.html"), board("A", 1200, 900));
	const edited = deck.resync();
	assert.deepEqual(
		edited.changed.map((b) => [b.path, b.w, b.h]),
		[["boards/a.html", 1200, 900]],
	);
	assert.deepEqual(edited.removed, []);

	// A board that arrived without an event, and one that left the same way.
	writeFileSync(join(root, "boards", "b.html"), board("B", 400, 300));
	rmSync(join(root, "boards", "a.html"));
	const moved = deck.resync();
	assert.deepEqual(
		moved.changed.map((b) => b.path),
		["boards/b.html"],
	);
	assert.deepEqual(moved.removed, ["boards/a.html"]);
	assert.deepEqual(
		deck.boards.map((b) => b.path),
		["boards/b.html"],
	);

	// Touched, not edited: a new signature and the same bytes is not news.
	const same = readFileSync(join(root, "boards", "b.html"), "utf8");
	writeFileSync(join(root, "boards", "b.html"), same);
	assert.deepEqual(deck.resync(), { changed: [], removed: [] });

	rmSync(root, { recursive: true, force: true });
});

test("resync keeps a board's place on the canvas", () => {
	const root = emptyDeck();
	writeFileSync(join(root, "boards", "a.html"), board("A", 800, 600));
	const deck = Deck.open(root);
	deck.setPosition("boards/a.html", 640, 480);

	writeFileSync(join(root, "boards", "a.html"), board("A", 900, 700));
	const [changed] = deck.resync().changed;
	assert.equal(changed?.x, 640);
	assert.equal(changed?.y, 480);
	assert.equal(changed?.w, 900);
	rmSync(root, { recursive: true, force: true });
});
