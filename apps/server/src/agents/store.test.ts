import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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

/**
 * The model survives the round trip.
 *
 * It did not, and nothing caught it because both sides were tested and the seam between
 * them was not: `record()` wrote `model` to `meta.json` and `validate()` never read it
 * back, so every restart handed a restored chat `undefined` and its runtime opened on
 * whatever it defaults to. A chat left on `deepseek-v4-pro` came back on
 * `deepseek-v4-flash`; a Claude chat left on Opus came back on "default".
 */
test("the model and the mode come back, because a resumed chat is opened on them", () => {
	const { deck, cleanup } = deckOn();
	const store = new AgentStore(deck);
	const record: AgentRecord = {
		id: "one",
		kind: "claude",
		name: "Iris",
		color: "#3b5cf6",
		context: [],
		inPlay: [],
		createdAt: 1,
		lastAt: 2,
		model: { provider: "anthropic", model: "opus[1m]", thinking: "high" },
		mode: "acceptEdits",
	};
	store.write(record, []);

	const back = store.read("one")?.record;
	assert.deepEqual(back?.model, { provider: "anthropic", model: "opus[1m]", thinking: "high" });
	assert.equal(back?.mode, "acceptEdits");
	cleanup();
});

/**
 * And a stored model that is not one is no model.
 *
 * These go straight into two runtimes' session options. A pair with no provider would be
 * asked for as `undefined/gpt-4`, and a thinking level from a build that has since renamed
 * one would be handed to an API that rejects it — so a half-written record degrades to
 * "the runtime picks", which is the answer a chat with no record already gives.
 */
test("a malformed model is dropped rather than passed on", () => {
	const { deck, cleanup } = deckOn();
	const store = new AgentStore(deck);
	const folder = join(deck.path, ".decks", "agents", "two");
	mkdirSync(folder, { recursive: true });
	writeFileSync(
		join(folder, "meta.json"),
		JSON.stringify({
			kind: "pi",
			name: "Ada",
			createdAt: 1,
			lastAt: 2,
			model: { model: "deepseek-v4-pro", thinking: "wildly" },
			mode: "whatever",
		}),
	);

	const back = store.read("two")?.record;
	assert.equal(back?.model, undefined, "no provider, so no model");
	assert.equal(back?.mode, undefined, "not one of the four modes");

	writeFileSync(
		join(folder, "meta.json"),
		JSON.stringify({ kind: "pi", name: "Ada", createdAt: 1, lastAt: 2, model: { provider: "opencode-go", model: "deepseek-v4-pro", thinking: "wildly" } }),
	);
	assert.deepEqual(
		store.read("two")?.record.model,
		{ provider: "opencode-go", model: "deepseek-v4-pro", thinking: "medium" },
		"a real pair with an unknown thinking level keeps the pair and takes the middle",
	);
	cleanup();
});

/*
 * And so does the subscription it was spending.
 *
 * The same seam as the model, and the same failure if it were missed: a field written by
 * `record()` and never read by `validate()` hands a restored chat `undefined`, which here
 * means the install default — so a conversation left on one account would quietly come back
 * spending another, and the only sign would be the bill.
 */
test("the account comes back too, because a restart must not move an agent's subscription", () => {
	const { deck, cleanup } = deckOn();
	const store = new AgentStore(deck);
	store.write(
		{
			id: "three",
			kind: "claude",
			name: "Rune",
			color: "#2eaf5a",
			context: [],
			inPlay: [],
			createdAt: 1,
			lastAt: 2,
			account: "67d596a8-a998-4ccf-a6f9-097c5f72fbd6",
		},
		[],
	);

	assert.equal(store.read("three")?.record.account, "67d596a8-a998-4ccf-a6f9-097c5f72fbd6");
	cleanup();
});

test("an account that is not a string is no account", () => {
	const { deck, cleanup } = deckOn();
	const store = new AgentStore(deck);
	const folder = join(deck.path, ".decks", "agents", "four");
	mkdirSync(folder, { recursive: true });
	writeFileSync(join(folder, "meta.json"), JSON.stringify({ kind: "claude", name: "Ada", createdAt: 1, lastAt: 2, account: { id: "nope" } }));

	// Falls back to the default rather than pointing a symlink at whatever that stringifies to.
	assert.equal(store.read("four")?.record.account, undefined);
	cleanup();
});

/*
 * The archive: what falls out of a session's window, so it can still be scrolled back to
 * (DESIGN §6.2). `chat.json` is the window; `chat.log` is everything older, one row per
 * line, appended at the moment of eviction.
 */

const said = (n: number, prefix = "u"): ChatItem[] =>
	Array.from({ length: n }, (_, i) => ({ kind: "user", id: `${prefix}${i}`, text: `line ${i}`, at: 1000 + i }) as ChatItem);

test("nothing is archived until something is evicted", () => {
	const { deck, cleanup } = deckOn();
	const store = new AgentStore(deck);
	store.write(record(), items);
	assert.equal(store.hasArchive("agent-1"), false, "a chat that has never overflowed offers no scrollback");
	assert.deepEqual(store.earlier("agent-1", "u0", 60), { items: [], more: false });
	store.archive("agent-1", []);
	assert.equal(store.hasArchive("agent-1"), false, "and an empty eviction is not an eviction");
	cleanup();
});

test("evicted rows come back in reading order, a page at a time", () => {
	const { deck, cleanup } = deckOn();
	const store = new AgentStore(deck);
	// Three separate evictions, because that is how they arrive: the log's order is the
	// conversation's order, and appending must not disturb it.
	store.archive("agent-1", said(40));
	store.archive("agent-1", said(40, "v"));
	store.archive("agent-1", said(20, "w"));
	assert.equal(store.hasArchive("agent-1"), true);

	// `before` is the oldest row the browser holds, which is in the *window* and so is not
	// in the log at all. That is the ordinary case, and it means "the end of the log".
	const first = store.earlier("agent-1", "live-row", 60);
	assert.equal(first.items.length, 60);
	assert.equal(first.items.at(-1)?.id, "w19", "the newest archived row is the one nearest what is held");
	assert.equal(first.items[0]?.id, "v0", "sixty back from the end, across two evictions");
	assert.equal(first.more, true, "40 rows still older than this page");

	// The second page is asked for by the oldest row of the first.
	const second = store.earlier("agent-1", "v0", 60);
	assert.equal(second.items.length, 40);
	assert.equal(second.items[0]?.id, "u0", "which is the beginning of the conversation");
	assert.equal(second.more, false, "and the browser is told to stop asking");
	cleanup();
});

test("a page smaller than what is left still says there is more", () => {
	const { deck, cleanup } = deckOn();
	const store = new AgentStore(deck);
	store.archive("agent-1", said(10));
	const page = store.earlier("agent-1", "u9", 4);
	assert.deepEqual(
		page.items.map((item) => item.id),
		["u5", "u6", "u7", "u8"],
	);
	assert.equal(page.more, true);
	cleanup();
});

test("a line that will not parse costs that line and nothing else", () => {
	const { deck, cleanup } = deckOn();
	const store = new AgentStore(deck);
	store.archive("agent-1", said(3));
	// A kill mid-append leaves a torn line; a row from an older build may be unreadable.
	appendFileSync(join(deck.path, ".decks", "agents", "agent-1", "chat.log"), '{"kind":"user","id":"tor\n');
	store.archive("agent-1", said(2, "v"));
	const page = store.earlier("agent-1", "live-row", 60);
	assert.deepEqual(
		page.items.map((item) => item.id),
		["u0", "u1", "u2", "v0", "v1"],
	);
	cleanup();
});

/*
 * The invariant the append log rests on: the log holds only rows older than the window, so
 * no row is ever in both files. It is asserted here because the two are written by
 * different paths — `write` rewrites the window, `archive` appends at eviction — and
 * nothing in the types would notice them overlapping.
 */
test("the log and the window never hold the same row", () => {
	const { deck, cleanup } = deckOn();
	const store = new AgentStore(deck);
	const conversation = said(120);
	const window = conversation.slice(60);
	store.archive("agent-1", conversation.slice(0, 60));
	store.write(record(), window);

	const held = new Set(store.read("agent-1")?.items.map((item) => item.id));
	const archived = store.earlier("agent-1", window[0]?.id ?? "", 200).items;
	assert.equal(archived.length, 60);
	assert.equal(
		archived.filter((item) => held.has(item.id)).length,
		0,
		"a row in both files would be drawn twice when the reader scrolled back",
	);
	// And the two together are the whole conversation, in order.
	assert.deepEqual([...archived, ...(store.read("agent-1")?.items ?? [])].map((item) => item.id), conversation.map((item) => item.id));
	cleanup();
});

test("forgetting a chat takes its archive with it", () => {
	const { deck, cleanup } = deckOn();
	const store = new AgentStore(deck);
	store.write(record(), items);
	store.archive("agent-1", said(5));
	store.forget("agent-1");
	assert.equal(store.hasArchive("agent-1"), false);
	assert.deepEqual(readdirSync(join(deck.path, ".decks", "agents")), []);
	cleanup();
});
