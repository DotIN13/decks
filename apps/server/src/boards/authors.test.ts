import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Authors } from "./authors.ts";

test("an author is kept across a restart, with the time they said it, and a repeat says nothing changed", () => {
	const deck = mkdtempSync(join(tmpdir(), "authors-"));
	const authors = new Authors(deck);
	assert.equal(authors.say("boards/plan.html", "agent-1", 1000), true);
	assert.equal(authors.say("boards/plan.html", "agent-1", 1000), false);
	assert.equal(authors.say("boards/plan.html", "agent-1", 2000), true, "the same writer again is a later act");
	assert.equal(authors.say("boards/plan.html", "you", 3000), true);
	assert.deepEqual(new Authors(deck).get("boards/plan.html"), { who: "you", at: 3000 });
});

test("a byline written before the time was kept still reads, as a writer with no time", () => {
	const deck = mkdtempSync(join(tmpdir(), "authors-"));
	mkdirSync(join(deck, ".decks"), { recursive: true });
	writeFileSync(join(deck, ".decks", "authors.json"), JSON.stringify({ "boards/old.html": "agent-1", "boards/odd.html": { who: "agent-2" } }));
	const authors = new Authors(deck);
	assert.deepEqual(authors.get("boards/old.html"), { who: "agent-1", at: 0 });
	assert.deepEqual(authors.get("boards/odd.html"), { who: "agent-2", at: 0 }, "a record with no time is not thrown away");
	assert.equal(authors.get("boards/gone.html"), undefined);
});

test("a deleted board is forgotten, and a broken file is an empty map", () => {
	const deck = mkdtempSync(join(tmpdir(), "authors-"));
	const authors = new Authors(deck);
	authors.say("boards/a.html", "agent-1", 1000);
	authors.forget("boards/a.html");
	assert.equal(new Authors(deck).get("boards/a.html"), undefined);
	mkdirSync(join(deck, ".decks"), { recursive: true });
	writeFileSync(join(deck, ".decks", "authors.json"), "{ not json");
	assert.deepEqual(new Authors(deck).entries(), []);
});
