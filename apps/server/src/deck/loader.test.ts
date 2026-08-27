import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

test("boards are found in subdirectories, and non-boards are not", () => {
	const root = emptyDeck();
	mkdirSync(join(root, "boards", "nested"), { recursive: true });
	writeFileSync(join(root, "boards", "a.html"), board("A"));
	writeFileSync(join(root, "boards", "nested", "b.htm"), board("B"));
	writeFileSync(join(root, "boards", "notes.md"), "# not a board");
	writeFileSync(join(root, "boards", ".hidden.html"), board("H"));
	const deck = Deck.open(root);
	assert.deepEqual(
		deck.boards.map((b) => b.path),
		["boards/a.html", "boards/nested/b.htm"],
	);
	rmSync(root, { recursive: true, force: true });
});
