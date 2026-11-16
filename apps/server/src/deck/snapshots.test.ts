import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { test } from "node:test";
import { Deck } from "../deck/loader.ts";
import { Revisions } from "./snapshots.ts";

/** Write a file, making its folder: a card is `cards/<name>/index.html`. */
function put(file: string, data: string | Uint8Array): void {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, data);
}


function deckWith(text: string) {
	const root = mkdtempSync(join(tmpdir(), "decks-rev-"));
	mkdirSync(join(root, "boards"), { recursive: true });
	put(join(root, "canvases", "t", "cards", "a", "index.html"), text);
	return { root, deck: Deck.open(root) };
}

test("the current state is revision zero, so the first edit has something to go back to", () => {
	const { root, deck } = deckWith("<title>one</title>");
	const revisions = new Revisions(deck);
	assert.equal(revisions.history("canvases/t/cards/a/index.html").length, 1);

	revisions.record("canvases/t/cards/a/index.html", "<title>two</title>");
	const back = revisions.history("canvases/t/cards/a/index.html")[0];
	assert.ok(back);
	assert.equal(revisions.read(back), "<title>one</title>");
	rmSync(root, { recursive: true, force: true });
});

test("recording the same bytes twice does not grow the history", () => {
	const { root, deck } = deckWith("<title>one</title>");
	const revisions = new Revisions(deck);
	revisions.record("canvases/t/cards/a/index.html", "<title>two</title>");
	revisions.record("canvases/t/cards/a/index.html", "<title>two</title>");
	assert.equal(revisions.history("canvases/t/cards/a/index.html").length, 2);
	rmSync(root, { recursive: true, force: true });
});

test("the order survives a restart — the bug the index exists to fix", () => {
	const { root, deck } = deckWith("<title>one</title>");
	const first = new Revisions(deck);
	first.record("canvases/t/cards/a/index.html", "<title>two</title>");
	first.record("canvases/t/cards/a/index.html", "<title>three</title>");
	// What a restart looks like: the file on disk is the newest version, and a new
	// store is built over the same directory.
	put(join(root, "canvases", "t", "cards", "a", "index.html"), "<title>three</title>");

	const after = new Revisions(Deck.open(root));
	assert.equal(after.history("canvases/t/cards/a/index.html").length, 3, "three versions, not one");
	assert.equal(after.read(after.history("canvases/t/cards/a/index.html")[0]!), "<title>one</title>", "the oldest is still the oldest");
	assert.equal(after.read(after.history("canvases/t/cards/a/index.html")[1]!), "<title>two</title>");
	rmSync(root, { recursive: true, force: true });
});

test("the version a board was at, at a moment in time", () => {
	const { root, deck } = deckWith("<title>one</title>");
	const revisions = new Revisions(deck);
	// Recorded with explicit times, since this is what the timeline asks about.
	revisions.record("canvases/t/cards/a/index.html", "<title>two</title>", 2000);
	revisions.record("canvases/t/cards/a/index.html", "<title>three</title>", 3000);

	assert.equal(revisions.read(revisions.at("canvases/t/cards/a/index.html", 2500)!), "<title>two</title>");
	assert.equal(revisions.read(revisions.at("canvases/t/cards/a/index.html", 3000)!), "<title>three</title>");
	assert.equal(revisions.read(revisions.at("canvases/t/cards/a/index.html", 9000)!), "<title>three</title>");
	// Before anything was recorded: the first version, which is the closest true
	// answer — not "did not exist", and not today's file.
	assert.equal(revisions.read(revisions.at("canvases/t/cards/a/index.html", 1)!), "<title>one</title>");
	assert.equal(revisions.at("canvases/t/cards/nope/index.html", 2500), undefined);
	rmSync(root, { recursive: true, force: true });
});

test("an index written by an older build still loads", () => {
	const { root, deck } = deckWith("<title>one</title>");
	const revisions = new Revisions(deck);
	revisions.record("canvases/t/cards/a/index.html", "<title>two</title>");
	const shas = [...revisions.history("canvases/t/cards/a/index.html")];
	// The shape this file used to have: bare shas, no timestamps.
	put(join(root, ".decks", "revisions", "index.json"), JSON.stringify({ "canvases/t/cards/a/index.html": shas }));

	const after = new Revisions(Deck.open(root));
	const history = after.history("canvases/t/cards/a/index.html");
	// Both legacy entries survive; the board's current content is appended as the
	// newest, which is right — the file saying "one" again is its own event.
	assert.ok(history.length >= shas.length, `${history.length} >= ${shas.length}`);
	assert.equal(after.read(history[0]!), "<title>one</title>");
	assert.equal(after.read(history.at(-1)!), "<title>one</title>");
	assert.ok(history.includes(shas[1]!), "the version that is not on disk is still known");
	rmSync(root, { recursive: true, force: true });
});

test("a revision id has to look like one", () => {
	const { root, deck } = deckWith("<title>one</title>");
	const revisions = new Revisions(deck);
	assert.throws(() => revisions.read("../../../etc/passwd"), /Not a revision id/);
	assert.equal(revisions.has("nonsense"), false);
	rmSync(root, { recursive: true, force: true });
});

test("the index only keeps revisions whose files are still there", () => {
	const { root, deck } = deckWith("<title>one</title>");
	const revisions = new Revisions(deck);
	revisions.record("canvases/t/cards/a/index.html", "<title>two</title>");
	revisions.record("canvases/t/cards/a/index.html", "<title>three</title>");
	put(join(root, "canvases", "t", "cards", "a", "index.html"), "<title>three</title>");

	// The middle one: not what the board says now, so nothing will re-create it.
	const middle = revisions.history("canvases/t/cards/a/index.html")[1]!;
	rmSync(join(root, ".decks", "revisions", `${middle}.html`));

	const after = new Revisions(Deck.open(root));
	assert.ok(!after.history("canvases/t/cards/a/index.html").includes(middle), "a dangling id is dropped, not served");
	assert.equal(after.history("canvases/t/cards/a/index.html").length, 2);
	rmSync(root, { recursive: true, force: true });
});
