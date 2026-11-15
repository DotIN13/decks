import { test } from "node:test";
import assert from "node:assert/strict";
import { callers, testServer } from "../kernel/testing.ts";
import { MemoryDeck } from "../kernel/memory-deck.ts";
import { features } from "../main.ts";

// Rules 16 to 18 of cards and rule 12 of documents, through the canvas.

const ann = callers.agent("ann", "a");
const seed = () =>
	new MemoryDeck({
		"canvases/a/canvas.pen": '{"version":"2.14","children":[]}',
		"canvases/a/cards/notes/index.html": "<title>Notes</title>\n<meta name=\"card\" content='{\"w\":760,\"h\":240}' />\n<p>hi</p>\n",
		"canvases/a/files/china.md": "# China\n",
	});
type Placed = { id: string; card?: string; path?: string; box: { x1: number; y1: number; x2: number; y2: number } };
const size = (item: Placed) => [item.box.x2 - item.box.x1, item.box.y2 - item.box.y1];

test("rule 16: a card given as html is written, then placed", async () => {
	const s = await testServer({ features: features(), deck: seed() });
	const placed = await s.value<Placed>("item.insert", { item: { type: "card", title: "Hello there", html: "<p>hello</p>", width: 500, height: 300 } }, ann);
	assert.equal(placed.card, "canvases/a/cards/hello-there/index.html");
	assert.deepEqual(size(placed), [500, 300]);
	const file = await s.value<{ text: string }>("file.read", { path: placed.card });
	assert.match(file.text, /<title>Hello there<\/title>/);
	await s.close();
});

test("rule 17: a card placed with no box takes its file's size", async () => {
	const s = await testServer({ features: features(), deck: seed() });
	const placed = await s.value<Placed>("item.insert", { item: { type: "card", card: "canvases/a/cards/notes/index.html" } }, ann);
	assert.deepEqual(size(placed), [760, 240]);
	await s.close();
});

test("rule 18: resizing a card on the canvas writes the size into its file", async () => {
	const s = await testServer({ features: features(), deck: seed() });
	const placed = await s.value<Placed>("item.insert", { item: { type: "card", card: "canvases/a/cards/notes" } }, ann);
	await s.value("item.update", { id: placed.id, size: { w: 900, h: 300 } }, ann);
	let text = "";
	for (let i = 0; i < 20 && !/"w":900/.test(text); i++) {
		await new Promise((r) => setTimeout(r, 10));
		text = (await s.value<{ text: string }>("file.read", { path: "canvases/a/cards/notes/index.html" })).text;
	}
	assert.match(text, /<meta name="card" content='\{"w":900,"h":300\}' \/>/);
	await s.close();
});

test("documents rule 12: a name from the canvas's folder is stored as the deck names it, with a note", async () => {
	const s = await testServer({ features: features(), deck: seed() });
	const answer = await s.call("item.insert", { item: { type: "document", path: "files/china.md" } }, ann);
	assert.ok(answer.ok);
	assert.equal((answer.value as Placed).path, "canvases/a/files/china.md");
	assert.ok(answer.notes.some((n) => /canvases\/a\/files\/china\.md/.test(n)), JSON.stringify(answer.notes));
	const made = await s.value<Placed>("item.insert", { item: { type: "document", path: "plan.md" } }, ann);
	assert.equal(made.path, "canvases/a/files/plan.md");
	assert.equal((await s.value<{ text: string }>("file.read", { path: "canvases/a/files/plan.md" })).text, "");
	const asPerson = await s.call("item.insert", { item: { type: "document", path: "files/new.md" }, canvas: "a" }, "person");
	assert.equal(asPerson.ok && (asPerson.value as Placed).path, "canvases/a/files/new.md");
	await s.close();
});
