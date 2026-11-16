import { test } from "node:test";
import assert from "node:assert/strict";
import type { Caller } from "../../protocol/index.ts";
import { MemoryDeck } from "./memory-deck.ts";
import { toDeckPath } from "./types.ts";

// What only the in-memory deck shows (the Deck's promises are deck-suite.ts):
// revisions count from one on its clock, it keeps its own copy, and a path is
// checked once.

const ann: Caller = { kind: "agent", id: "ann", name: "Ann" };
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const p = toDeckPath;

test("a write is read back, with its author and the next revision", async () => {
	const deck = new MemoryDeck({}, () => 5);
	const first = await deck.write(p("docs/a.md"), new TextEncoder().encode("hi"), ann);
	const second = await deck.write(p("docs/b.md"), new TextEncoder().encode("yo"), ann);
	assert.deepEqual(first, { path: "docs/a.md", rev: 1, by: "ann", at: 5 });
	assert.equal(second.rev, 2);
	assert.equal(text(await deck.read(p("docs/a.md"))), "hi");
});

test("a path outside the deck, or hidden, is refused before it is used", () => {
	for (const bad of ["../x", "/etc/passwd", ".git/config", "a/../../x"]) assert.throws(() => toDeckPath(bad), { code: "invalid" }, bad);
	assert.equal(toDeckPath("./docs/a.md"), "docs/a.md");
});

test("the deck keeps its own copy of what it was given", async () => {
	const deck = new MemoryDeck();
	const bytes = new Uint8Array([1, 2]);
	await deck.write(p("f"), bytes, ann);
	bytes[0] = 9;
	assert.equal((await deck.read(p("f")))[0], 1);
});
