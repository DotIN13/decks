import { test } from "node:test";
import assert from "node:assert/strict";
import { callers } from "../../kernel/testing.ts";
import { MemoryDeck } from "../../kernel/memory-deck.ts";
import { memoryStores, MemoryStore, readJson, writeJson } from "../../kernel/store.ts";
import { upgradeNews } from "./news.ts";

// The README's rule 20: today's bylines and read times, moved once into the cards store.

const card = "canvases/a/cards/kept/index.html";
const board = "canvases/a/cards/was-a-board/index.html";

async function deckOfToday() {
	const deck = new MemoryDeck();
	for (const path of [card, board]) await deck.write(path as never, new TextEncoder().encode("<title>x</title>"), callers.person);
	const old = new MemoryStore();
	await writeJson(old, "authors.json", { [card]: { who: "agent-1", at: 100 }, "canvases/a/boards/was-a-board.html": { who: "agent-2", at: 200 }, "canvases/a/boards/gone.html": { who: "agent-3", at: 300 }, "canvases/a/cards/kept/x.css": { who: "agent-4", at: 1 } });
	await writeJson(old, "seen.json", { [card]: 150, "canvases/a/boards/was-a-board.html": 250, "canvases/a/boards/gone.html": 350 });
	return { deck, parts: { stores: memoryStores(), old } };
}

test("rule 20: claims and reads come over, a board's to the card made of it, and the rest are left", async () => {
	const { deck, parts } = await deckOfToday();
	await upgradeNews(deck, parts);
	const store = parts.stores("cards");
	assert.deepEqual(await readJson(store, `claims/${card}`, undefined), { by: "agent-1", rev: 0, at: 100 });
	assert.equal((await readJson<{ by: string }>(store, `claims/${board}`, { by: "" })).by, "agent-2");
	assert.equal(await readJson(store, `seen/${card}`, undefined), 150);
	assert.equal(await readJson(store, `seen/${board}`, undefined), 250);
	assert.deepEqual((await store.keys("claims/")).sort(), [`claims/${card}`, `claims/${board}`]);
});

test("rule 20: once per deck, and a card's own record is never overwritten", async () => {
	const { deck, parts } = await deckOfToday();
	const store = parts.stores("cards");
	await writeJson(store, `seen/${card}`, 999);
	await upgradeNews(deck, parts);
	assert.equal(await readJson(store, `seen/${card}`, undefined), 999);
	await writeJson(parts.old, "seen.json", { [board]: 1 });
	await store.delete(`seen/${board}`);
	await upgradeNews(deck, parts);
	assert.equal(await readJson(store, `seen/${board}`, undefined), undefined);
});
