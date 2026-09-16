import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Deck } from "./loader.ts";
import { withBoardSize } from "./meta.ts";
import { slideHeight } from "./kinds.ts";
import { realPathOf } from "./roots.ts";

function board(title: string, w?: number, h?: number): string {
	const meta = w && h ? `<meta name="board" content='{"w":${w},"h":${h}}'>` : "";
	return `<!doctype html><html><head><title>${title}</title>${meta}</head><body class="board"></body></html>`;
}

/** A deck in reveal's own markup — a size this app keeps in the record rather than the file. */
function slideDeck(title: string): string {
	return `<!doctype html><html><head><title>${title}</title></head><body class="reveal"><div class="slides"></div></body></html>`;
}

/** A page from somewhere else: neither class, so it is sandboxed and cannot measure itself. */
function foreign(title: string): string {
	return `<!doctype html><html><head><title>${title}</title></head><body><p>Saved.</p></body></html>`;
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
	// Through `state()`: the arrangement is computed when the boards are sent, not stored on them, which
	// is what a stage's positions made true. The board list itself is only the list of boards.
	const boxes = deck.state().boards.map((b) => ({ path: b.path, x: b.x, y: b.y, w: b.w, h: b.h }));
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

test("a stage's own place wins over the auto-layout, and the deck file is not where it is written", () => {
	const root = emptyDeck();
	writeFileSync(join(root, "boards", "a.html"), board("A", 800, 600));
	const deck = Deck.open(root);
	const state = deck.state({ "boards/a.html": { x: 42, y: 99 } });
	assert.deepEqual([state.boards[0]?.x, state.boards[0]?.y], [42, 99]);

	// The place belongs to a stage's own record — `AgentRecord.positions` — and nowhere else, so the
	// deck file it used to be written to does not gain one.
	const arrangement = JSON.parse(readFileSync(join(root, "deck.json"), "utf8")) as Record<string, unknown>;
	assert.equal("boards" in arrangement, false);
	assert.equal("sizes" in arrangement, false);
	rmSync(root, { recursive: true, force: true });
});

test("a board nobody placed lands under this stage's arrangement, not the deck's", () => {
	const root = emptyDeck();
	for (const name of ["a", "b", "c", "d"]) writeFileSync(join(root, "boards", `${name}.html`), board(name.toUpperCase(), 400, 300));
	const deck = Deck.open(root);
	// One board down at y=2000, and three with no place of their own.
	const state = deck.state({ "boards/a.html": { x: 0, y: 2000 } });
	const others = state.boards.filter((one) => one.path !== "boards/a.html");
	// The rows start under the stage's own arrangement rather than at the origin — which is the one
	// line the per-stage change actually touched: whose boards `autoPlace` counts as placed.
	for (const other of others) assert.ok(other.y > 2300, `${other.path} sits below the placed board`);
	assert.equal(new Set(others.map((one) => one.y)).size, 1, "three fit on the first row");
	assert.deepEqual(others.map((one) => one.x), [0, 560, 1120]);
	rmSync(root, { recursive: true, force: true });
});

test("the auto-layout reports the places it worked out, and a stage that keeps them stops chasing", () => {
	const root = emptyDeck();
	for (const name of ["a", "b", "c", "d"]) writeFileSync(join(root, "boards", `${name}.html`), board(name.toUpperCase(), 400, 300));
	const deck = Deck.open(root);
	const places: Record<string, { x: number; y: number }> = { "boards/a.html": { x: 0, y: 0 } };
	const worked: string[] = [];
	deck.state(places, (path, at) => {
		worked.push(path);
		places[path] = at;
	});
	assert.deepEqual(worked.sort(), ["boards/b.html", "boards/c.html", "boards/d.html"]);

	// Keeping them is the whole point: move the one board that *was* placed and the others stay put.
	// Derived on every send, they would follow the frontier down — a board that moves because you
	// moved a different one, which is what "haunted" means here.
	const before = deck.state(places).boards.map((one) => [one.path, one.x, one.y] as const);
	const after = deck.state({ ...places, "boards/a.html": { x: 0, y: 6000 } }).boards.map((one) => [one.path, one.x, one.y] as const);
	for (const [path, x, y] of before) {
		if (path === "boards/a.html") continue;
		assert.deepEqual(after.find((entry) => entry[0] === path)?.slice(1), [x, y], `${path} did not move`);
	}

	// And with every place kept, a send has nothing left to work out.
	const again: string[] = [];
	deck.state({ ...places, "boards/a.html": { x: 0, y: 6000 } }, (path) => again.push(path));
	assert.deepEqual(again, []);
	rmSync(root, { recursive: true, force: true });
});

test("a board's size is its own file's, and deck.json's copy is ignored", () => {
	const root = emptyDeck();
	writeFileSync(join(root, "boards", "a.html"), board("A", 800, 600));
	// A resize writes the file, whichever format it is: the tag for HTML, front-matter for markdown.
	writeFileSync(join(root, "boards", "saved.html"), withBoardSize("boards/saved.html", foreign("Saved"), { w: 900, h: 700 }));
	writeFileSync(join(root, "boards", "talk.slides.html"), withBoardSize("boards/talk.slides.html", slideDeck("Talk"), { w: 1440 }));
	/*
	 * And an older `deck.json`'s numbers are not read at all.
	 *
	 * This is the shadowing the record used to do: `describe` preferred its copy of a width over the
	 * file's, so a resize — which writes the file — appeared to do nothing, and a flow board's width
	 * could not be changed for as long as the two disagreed.
	 */
	writeFileSync(
		join(root, "deck.json"),
		JSON.stringify({
			version: 1,
			name: "T",
			boards: {
				"boards/saved.html": { x: 0, y: 0, w: 320, h: 240 },
				"boards/talk.slides.html": { x: 0, y: 0, w: 400 },
			},
		}),
	);

	const deck = Deck.open(root);
	assert.deepEqual([deck.board("boards/saved.html")?.w, deck.board("boards/saved.html")?.h], [900, 700], "the file's numbers, not the record's");
	assert.equal(deck.board("boards/talk.slides.html")?.w, 1440);
	assert.equal(deck.board("boards/talk.slides.html")?.h, slideHeight(1440, undefined));
	assert.deepEqual(
		[deck.board("boards/a.html")?.w, deck.board("boards/a.html")?.h],
		[800, 600],
		"and a component board is its own <meta> as it always was",
	);
	rmSync(root, { recursive: true, force: true });
});

test("a legacy boards map gives its places as a seed, and none of its sizes", () => {
	const root = emptyDeck();
	writeFileSync(join(root, "boards", "saved.html"), foreign("Saved"));
	writeFileSync(
		join(root, "deck.json"),
		JSON.stringify({ version: 1, name: "T", boards: { "boards/saved.html": { x: 120, y: 340, w: 900, h: 700 } } }),
	);
	const deck = Deck.open(root);
	// A size in this file is not a size any more: the board's own file is the only place one lives, and
	// this board's file says nothing, so it takes the placeholder for a foreign page.
	assert.notDeepEqual([deck.board("boards/saved.html")?.w, deck.board("boards/saved.html")?.h], [900, 700]);

	/*
	 * The place is the seed a stage starts from — reported through `onPlace` so the stage writes it
	 * down and the map stops mattering. A deck somebody laid out by hand must not open in rows of three
	 * the day the map stops being authoritative.
	 */
	const kept: Record<string, { x: number; y: number }> = {};
	const state = deck.state(undefined, (path, at) => (kept[path] = at));
	assert.deepEqual([state.boards[0]?.x, state.boards[0]?.y], [120, 340], "the deck's own arrangement");
	assert.deepEqual(kept, { "boards/saved.html": { x: 120, y: 340 } }, "and the caller is told, so it can keep it");

	// A stage that already has a place is not seeded again — and reading a deck writes nothing at all,
	// which is why the old map is still on disk for the next conversation to seed from.
	const before = readFileSync(join(root, "deck.json"), "utf8");
	const again: string[] = [];
	deck.state(kept, (path) => again.push(path));
	assert.deepEqual(again, []);
	assert.equal(readFileSync(join(root, "deck.json"), "utf8"), before, "nothing about reading a deck writes it");
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
