import assert from "node:assert/strict";
import { test } from "node:test";
import { parse, serialize, type PenDocument } from "@decks/pen";
import type { Caller } from "../../../protocol/index.ts";
import { MemoryDeck } from "../../kernel/memory-deck.ts";
import { toDeckPath } from "../../kernel/types.ts";
import { memoryStore, memoryStudio } from "../testing.ts";
import { conflictName } from "./files.ts";
import { DeckSync } from "./sync.ts";

// A canvas is its Studio id, not its folder: a same-named canvas from a second
// harness merges into it, a rename keeps it, a lost state finds it again, a
// copy becomes its own, and a file both sides changed is kept on both.

const me: Caller = { kind: "person", id: "ada", name: "Ada" };
const drawing = (...notes: string[]) => serialize({ version: "2.14", children: notes.map((id, i) => ({ id, type: "note", content: id, x: i * 100, y: 0 })) } as never);
const read = async (deck: MemoryDeck, path: string) => new TextDecoder().decode(await deck.read(toDeckPath(path)));
const write = (deck: MemoryDeck, path: string, text: string) => deck.write(toDeckPath(path), new TextEncoder().encode(text), me);
const ids = (doc: PenDocument) => (doc.children as { id: string }[]).map((n) => n.id).sort();
const idsAt = async (deck: MemoryDeck, folder: string) => ids(parse(await read(deck, `${folder}/canvas.pen`)));

function world() {
	const studio = memoryStudio();
	studio.hub.name("ada", "Ada Lovelace");
	studio.keys.set("mini", { user: { id: "ada", name: "Ada Lovelace" }, harness: { id: "h-mini", name: "mini" } });
	studio.keys.set("laptop", { user: { id: "ada", name: "Ada Lovelace" }, harness: { id: "h-laptop", name: "laptop" } });
	const harness = (key: string, store = memoryStore(), deck = new MemoryDeck()) => ({ deck, store, sync: new DeckSync({ deck, store, url: studio.url, key, transport: studio.transport }) });
	return { studio, harness };
}

test("a second harness with a same-named canvas merges into it: one canvas, both items, the file kept both ways", async () => {
	const { studio, harness } = world();
	const a = harness("mini");
	const b = harness("laptop");
	await write(a.deck, "canvases/plan/canvas.pen", drawing("n1"));
	await write(a.deck, "canvases/plan/cards/plan/index.html", "<h1>Plan, mini</h1>");
	await a.sync.sync();
	await write(b.deck, "canvases/plan/canvas.pen", drawing("n9"));
	await write(b.deck, "canvases/plan/cards/plan/index.html", "<h1>Plan, laptop</h1>");
	await b.sync.sync();
	const canvases = studio.hub.canvases("ada");
	assert.equal(canvases.length, 1, "no second canvas");
	const id = canvases[0]!.id;
	assert.deepEqual(ids(studio.hub.canvas(id)!.pen), ["n1", "n9"]);
	assert.deepEqual(await idsAt(b.deck, "canvases/plan"), ["n1", "n9"]);
	assert.equal(JSON.parse(await read(b.deck, "canvases/plan/canvas.json")).studio, id);
	await a.sync.sync();
	assert.deepEqual(await idsAt(a.deck, "canvases/plan"), ["n1", "n9"]);
	assert.equal(await read(b.deck, "canvases/plan/cards/plan/index.html"), "<h1>Plan, mini</h1>");
	const kept = (await b.deck.list(toDeckPath("canvases/plan/cards/plan"))).map((e) => e.path).find((p) => p.includes(".conflict-"))!;
	assert.match(kept, /index\.conflict-\d{8}-\d{4}\.html$/);
	assert.equal(await read(b.deck, kept), "<h1>Plan, laptop</h1>");
	assert.deepEqual(b.sync.conflicts, ["plan:cards/plan/index.html"]);
	await a.sync.sync();
	assert.equal(await read(a.deck, kept), "<h1>Plan, laptop</h1>", "and the copy reaches the mini");
});

test("a folder renamed keeps its canvas; a lost state finds it again with its edit; a copy becomes a canvas of its own", async () => {
	const { studio, harness } = world();
	const a = harness("mini");
	await write(a.deck, "canvases/plan/canvas.pen", drawing("n1"));
	await a.sync.sync();
	const id = studio.hub.canvases("ada")[0]!.id;
	await a.deck.move(toDeckPath("canvases/plan"), toDeckPath("canvases/roadmap"), me);
	await write(a.deck, "canvases/roadmap/canvas.pen", drawing("n1", "n2"));
	await a.sync.sync();
	assert.equal(studio.hub.canvases("ada").length, 1, "a rename is not a new canvas");
	assert.deepEqual(ids(studio.hub.canvas(id)!.pen), ["n1", "n2"]);

	const lost = harness("mini", memoryStore(), a.deck);
	await write(a.deck, "canvases/roadmap/canvas.pen", drawing("n1", "n2", "n3"));
	await lost.sync.sync();
	assert.equal(studio.hub.canvases("ada").length, 1);
	assert.deepEqual(ids(studio.hub.canvas(id)!.pen), ["n1", "n2", "n3"], "the edit made while the state was lost went up");

	await write(a.deck, "canvases/roadmap-copy/canvas.pen", await read(a.deck, "canvases/roadmap/canvas.pen"));
	await write(a.deck, "canvases/roadmap-copy/canvas.json", await read(a.deck, "canvases/roadmap/canvas.json"));
	await lost.sync.sync();
	const after = studio.hub.canvases("ada");
	assert.deepEqual(after.map((c) => c.name).sort(), ["plan", "roadmap-copy"]);
	const copy = after.find((c) => c.name === "roadmap-copy")!.id;
	assert.notEqual(copy, id);
	assert.equal(JSON.parse(await read(a.deck, "canvases/roadmap-copy/canvas.json")).studio, copy);
	assert.equal(JSON.parse(await read(a.deck, "canvases/roadmap/canvas.json")).studio, id);
});

test("a conflicted copy's name", () => {
	const at = new Date("2026-11-03T00:12:45Z");
	assert.equal(conflictName("cards/plan/index.html", at), "cards/plan/index.conflict-20261103-0012.html");
	assert.equal(conflictName("files/notes", at), "files/notes.conflict-20261103-0012");
	assert.equal(conflictName("files/.hidden", at), "files/.hidden.conflict-20261103-0012");
});
