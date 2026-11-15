import { test } from "node:test";
import assert from "node:assert/strict";
import type { Caller } from "../../protocol/index.ts";
import { MemoryDeck } from "./memory-deck.ts";
import { MemoryStore } from "./store.ts";
import { defineFeature, toDeckPath, type FileChange } from "./types.ts";

// The in-memory deck keeps the Deck's promises: reads what was written,
// records who wrote it, lists folders, tells watchers, refuses bad paths.

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

test("a read of nothing is refused as not_found", async () => {
	await assert.rejects(new MemoryDeck().read(p("x.md")), { code: "not_found" });
});

test("list gives a folder's files and folders, once each", async () => {
	const deck = new MemoryDeck({ "canvases/a/canvas.pen": "{}", "canvases/a/cards/x/index.html": "<p>", "assets/i.png": "png" });
	assert.deepEqual(
		(await deck.list("")).map((e) => `${e.kind}:${e.path}`),
		["dir:assets", "dir:canvases"],
	);
	assert.deepEqual(
		(await deck.list(p("canvases/a"))).map((e) => `${e.kind}:${e.path}`),
		["file:canvases/a/canvas.pen", "dir:canvases/a/cards"],
	);
	await assert.rejects(deck.list(p("nowhere")), { code: "not_found" });
});

test("watchers hear writes and deletes until they stop", async () => {
	const deck = new MemoryDeck();
	const heard: FileChange[] = [];
	const stop = deck.watch((c) => heard.push(c));
	await deck.write(p("a.txt"), new Uint8Array([1]), ann);
	await deck.remove(p("a.txt"), ann);
	stop();
	await deck.write(p("b.txt"), new Uint8Array([1]), ann);
	assert.deepEqual(
		heard.map((c) => `${c.kind}:${c.path}`),
		["written:a.txt", "deleted:a.txt"],
	);
});

test("remove and move take a whole folder", async () => {
	const deck = new MemoryDeck({ "cards/x/index.html": "a", "cards/x/c.js": "b" });
	await deck.move(p("cards/x"), p("cards/y"), ann);
	assert.equal(text(await deck.read(p("cards/y/c.js"))), "b");
	await assert.rejects(deck.read(p("cards/x/c.js")), { code: "not_found" });
	await deck.remove(p("cards/y"), ann);
	assert.deepEqual(await deck.list(""), []);
});

test("a write over a folder, or a move onto a file, is a conflict", async () => {
	const deck = new MemoryDeck({ "a/b.txt": "1", "c.txt": "2" });
	await assert.rejects(deck.write(p("a"), new Uint8Array(), ann), { code: "conflict" });
	await assert.rejects(deck.move(p("a"), p("c.txt"), ann), { code: "conflict" });
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

test("a feature built on a MemoryDeck starts with the kernel it is handed", async () => {
	const deck = new MemoryDeck({ "a.txt": "x" });
	let seen = "";
	const feature = defineFeature({ name: "probe", calls: [], start: async (kernel) => void (seen = new TextDecoder().decode(await kernel.deck.read(p("a.txt")))) });
	await feature.start?.({ deck, events: { emit() {}, on: () => () => {} }, canvas: () => ({ read: () => [], apply: () => ({ items: [], rev: 0 }), since: () => [] }), callers: { issue: () => "", revoke() {}, describe() {} }, store: () => new MemoryStore(), kinds: [], relay() {}, translate() {}, guard() {}, filter() {}, sees() {}, call: async () => ({ ok: true, value: null, notes: [] }), url: () => undefined, folder: () => undefined, machine: () => "/tmp", deckId: () => "d", mount() {}, unmount() {} });
	assert.equal(seen, "x");
});
