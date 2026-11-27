import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Authors } from "./authors.ts";

test("an author is kept across a restart, with the time they said it, and a repeat says nothing changed", () => {
	const deck = mkdtempSync(join(tmpdir(), "authors-"));
	const authors = new Authors(deck);
	assert.equal(authors.say("pages/plan.html", "agent-1", 1000), true);
	assert.equal(authors.say("pages/plan.html", "agent-1", 1000), false);
	assert.equal(authors.say("pages/plan.html", "agent-1", 2000), true, "the same writer again is a later act");
	assert.equal(authors.say("pages/plan.html", "you", 3000), true);
	assert.deepEqual(new Authors(deck).get("pages/plan.html"), { who: "you", at: 3000 });
});

test("a byline written before the time was kept still reads, as a writer with no time", () => {
	const deck = mkdtempSync(join(tmpdir(), "authors-"));
	mkdirSync(join(deck, ".decks"), { recursive: true });
	writeFileSync(join(deck, ".decks", "authors.json"), JSON.stringify({ "pages/old.html": "agent-1", "pages/odd.html": { who: "agent-2" } }));
	const authors = new Authors(deck);
	assert.deepEqual(authors.get("pages/old.html"), { who: "agent-1", at: 0 });
	assert.deepEqual(authors.get("pages/odd.html"), { who: "agent-2", at: 0 }, "a record with no time is not thrown away");
	assert.equal(authors.get("pages/gone.html"), undefined);
});

test("a deleted card is forgotten, and a broken file is an empty map", () => {
	const deck = mkdtempSync(join(tmpdir(), "authors-"));
	const authors = new Authors(deck);
	authors.say("pages/a.html", "agent-1", 1000);
	authors.forget("pages/a.html");
	assert.equal(new Authors(deck).get("pages/a.html"), undefined);
	mkdirSync(join(deck, ".decks"), { recursive: true });
	writeFileSync(join(deck, ".decks", "authors.json"), "{ not json");
	assert.deepEqual(new Authors(deck).entries(), []);
});
