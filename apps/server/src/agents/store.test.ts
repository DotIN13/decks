import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ChatItem } from "@decks/protocol";
import { Deck } from "../deck/loader.ts";
import { AgentStore, type AgentRecord } from "./store.ts";

function deckOn(): { deck: Deck; root: string; cleanup: () => void } {
	const root = mkdtempSync(join(tmpdir(), "decks-agent-store-"));
	mkdirSync(join(root, "boards"), { recursive: true });
	writeFileSync(join(root, "boards", "plan.html"), '<!doctype html><body class="board"></body>');
	return { deck: Deck.open(root), root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function record(over: Partial<AgentRecord> = {}): AgentRecord {
	return {
		id: "agent-1",
		kind: "pi",
		resumeRef: "/sessions/one.jsonl",
		name: "Kestrel",
		color: "#3b5cf6",
		context: ["boards/plan.html"],
		inPlay: ["boards/plan.html"],
		createdAt: 1000,
		lastAt: 2000,
		...over,
	};
}

const items: ChatItem[] = [
	{ kind: "user", id: "agent-1:u1", text: "what is the plan", at: 1500 },
	{ kind: "assistant", id: "agent-1:a2", text: "on the board", at: 1600 },
];

test("a record and its transcript come back as they went in", () => {
	const { deck, cleanup } = deckOn();
	const store = new AgentStore(deck);

	store.write(record(), items);
	const found = store.read("agent-1");

	assert.deepEqual(found?.record, record());
	assert.deepEqual(found?.items, items);
	cleanup();
});

test("the id comes from the directory, not from what the file claims", () => {
	const { deck, cleanup } = deckOn();
	const store = new AgentStore(deck);

	// A record that names an agent it is not could otherwise reach the avatar at
	// `.decks/avatars/<id>.svg`, which is addressed by exactly this id.
	store.write(record({ id: "agent-1" }), items);
	writeFileSync(
		join(deck.path, ".decks", "agents", "agent-1", "meta.json"),
		JSON.stringify({ ...record(), id: "somebody-else" }),
	);

	assert.equal(store.read("agent-1")?.record.id, "agent-1");
	cleanup();
});

test("a torn transcript costs the transcript, not the chat", () => {
	const { deck, cleanup } = deckOn();
	const store = new AgentStore(deck);
	store.write(record(), items);

	// What a process killed mid-write would have left, if the write were not atomic.
	writeFileSync(join(deck.path, ".decks", "agents", "agent-1", "chat.json"), '[{"kind":"user","id":"agent-1:u1"');

	const found = store.read("agent-1");
	assert.equal(found?.record.name, "Kestrel", "the row still rebuilds");
	assert.deepEqual(found?.items, [], "with no transcript rather than no chat");
	cleanup();
});

test("a torn record is skipped, because a row cannot be rebuilt without it", () => {
	const { deck, cleanup } = deckOn();
	const store = new AgentStore(deck);
	store.write(record(), items);
	writeFileSync(join(deck.path, ".decks", "agents", "agent-1", "meta.json"), "{ not json");

	assert.equal(store.read("agent-1"), undefined);
	assert.deepEqual(store.list(), [], "and it does not appear in the list either");
	cleanup();
});

test("an older record missing fields reads with defaults rather than throwing", () => {
	const { deck, cleanup } = deckOn();
	const store = new AgentStore(deck);
	mkdirSync(join(deck.path, ".decks", "agents", "old"), { recursive: true });
	writeFileSync(join(deck.path, ".decks", "agents", "old", "meta.json"), JSON.stringify({ name: "Tern" }));

	const found = store.read("old");
	assert.equal(found?.record.name, "Tern");
	assert.equal(found?.record.kind, "pi", "an unknown runtime is the default one");
	assert.deepEqual(found?.record.context, []);
	assert.equal(found?.record.lastAt, found?.record.createdAt, "undated sorts by its own creation");
	cleanup();
});

test("the list is newest conversation first", () => {
	const { deck, cleanup } = deckOn();
	const store = new AgentStore(deck);
	store.write(record({ id: "old", lastAt: 100 }), []);
	store.write(record({ id: "new", lastAt: 900 }), []);
	store.write(record({ id: "middle", lastAt: 500 }), []);

	assert.deepEqual(
		store.list().map((found) => found.record.id),
		["new", "middle", "old"],
	);
	cleanup();
});

test("prune keeps the newest and forgets the rest", () => {
	const { deck, cleanup } = deckOn();
	const store = new AgentStore(deck);
	for (let index = 0; index < 20; index += 1) store.write(record({ id: `a${index}`, lastAt: index }), []);

	const kept = store.prune(15);

	assert.equal(kept.length, 15);
	assert.equal(kept[0]?.record.id, "a19", "the newest survives");
	assert.equal(kept.at(-1)?.record.id, "a5");
	assert.equal(readdirSync(join(deck.path, ".decks", "agents")).length, 15, "and the rest are off the disk");
	cleanup();
});

test("forget removes one chat and leaves the others", () => {
	const { deck, cleanup } = deckOn();
	const store = new AgentStore(deck);
	store.write(record({ id: "keep" }), items);
	store.write(record({ id: "drop" }), items);

	store.forget("drop");

	assert.equal(store.read("drop"), undefined);
	assert.equal(store.read("keep")?.record.name, "Kestrel");
	cleanup();
});

test("a deck with no agents directory lists nothing rather than throwing", () => {
	const { deck, cleanup } = deckOn();
	assert.deepEqual(new AgentStore(deck).list(), []);
	cleanup();
});

test("setDeck moves the store to another deck's records", () => {
	const first = deckOn();
	const second = deckOn();
	const store = new AgentStore(first.deck);
	store.write(record(), items);

	store.setDeck(second.deck);
	assert.deepEqual(store.list(), [], "a different deck is a different set of chats");

	store.setDeck(first.deck);
	assert.equal(store.list().length, 1);
	first.cleanup();
	second.cleanup();
});

test("a write leaves no temporary file behind", () => {
	const { deck, cleanup } = deckOn();
	new AgentStore(deck).write(record(), items);

	const files = readdirSync(join(deck.path, ".decks", "agents", "agent-1"));
	assert.deepEqual(files.filter((name) => name.endsWith(".tmp")), [], "the rename consumed it");
	assert.deepEqual(files.sort(), ["chat.json", "meta.json"]);
	cleanup();
});
