import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Authors } from "./authors.ts";

test("an author is kept across a restart, and a repeat says nothing changed", () => {
	const deck = mkdtempSync(join(tmpdir(), "authors-"));
	const authors = new Authors(deck);
	assert.equal(authors.set("boards/plan.html", "agent-1"), true);
	assert.equal(authors.set("boards/plan.html", "agent-1"), false);
	assert.equal(authors.set("boards/plan.html", "you"), true);
	assert.equal(new Authors(deck).get("boards/plan.html"), "you");
	assert.match(readFileSync(join(deck, ".decks", "authors.json"), "utf8"), /"boards\/plan\.html": "you"/);
});

test("a deleted board is forgotten, and a broken file is an empty map", () => {
	const deck = mkdtempSync(join(tmpdir(), "authors-"));
	const authors = new Authors(deck);
	authors.set("boards/a.html", "agent-1");
	authors.forget("boards/a.html");
	assert.equal(new Authors(deck).get("boards/a.html"), undefined);
	mkdirSync(join(deck, ".decks"), { recursive: true });
	writeFileSync(join(deck, ".decks", "authors.json"), "{ not json");
	assert.deepEqual(new Authors(deck).entries(), []);
});
