// The agents migration (0.6.0) over the old-deck fixture: each agent of today's .decks/agents becomes
// a people record with its id, its home canvas when the deck has it, and a numbered name when two
// match; today's files stay, a copy of each meta.json and avatar goes under backups/, and it runs once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { MemoryDeck } from "../kernel/memory-deck.ts";
import { MemoryStore, memoryStores, readJson } from "../kernel/store.ts";
import { upgradeDeck } from "./feature.ts";
import { memoryVersion, readRecord } from "./version.ts";

const FIXTURE = new URL("../../tools/fixtures/old-deck/", import.meta.url).pathname;

/** The fixture's files: the deck's own (deck.json, canvases/) and today's .decks/ leftovers apart. */
function fixture(): { deck: Record<string, string>; old: MemoryStore } {
	const deck: Record<string, string> = {};
	const old = new MemoryStore();
	const walk = (dir: string) => {
		for (const name of readdirSync(dir)) {
			const path = join(dir, name);
			if (statSync(path).isDirectory()) walk(path);
			else {
				const key = relative(FIXTURE, path);
				if (key.startsWith(".decks/")) void old.put(key.slice(".decks/".length), new TextEncoder().encode(readFileSync(path, "utf8")));
				else deck[key] = readFileSync(path, "utf8");
			}
		}
	};
	walk(FIXTURE);
	return { deck, old };
}

type PeopleRecord = { id: string; name: string; color: string; tags: string[]; avatar?: string; kind?: string; workspace?: string; canvas?: string; model?: string; thinking?: string; mode?: string; at: number };

async function migrated() {
	const { deck, old } = fixture();
	const stores = memoryStores();
	const file = memoryVersion(String(new TextDecoder().decode((await old.get("migrations.json"))!)));
	const said = await upgradeDeck(new MemoryDeck(deck), file, undefined, undefined, { stores, old });
	const people = stores("people");
	const records: PeopleRecord[] = [];
	for (const key of await people.keys("agents/")) records.push((await readJson<PeopleRecord>(people, key, undefined as never))!);
	return { said, file, old, stores, people, records: records.sort((a, b) => a.at - b.at), deck };
}

test("each of today's agents becomes a people record with its id, and the deck is at 0.6.0", async () => {
	const { records, file, said } = await migrated();
	assert.deepEqual(records.map((r) => r.id), ["0f3c1a2e-0000-4000-8000-000000000002", "0f3c1a2e-0000-4000-8000-000000000001", "0f3c1a2e-0000-4000-8000-000000000003"]);
	assert.equal((await readRecord(file)).version, "0.6.0");
	assert.match(said.join(" "), /3 of today's 3 agents/);
});

test("a record keeps name, kind, colour, tags, workspace, model, thinking, mode and creation time, with the avatar inline", async () => {
	const ada = (await migrated()).records.find((r) => r.id.endsWith("001"))!;
	assert.equal(ada.name, "Ada");
	assert.equal(ada.kind, "claude");
	assert.equal(ada.color, "#e7af36");
	assert.deepEqual(ada.tags, ["films"]);
	assert.equal(ada.workspace, "demo");
	assert.equal(ada.canvas, "plan");
	assert.equal(ada.model, "opus");
	assert.equal(ada.thinking, "high");
	assert.equal(ada.mode, "auto");
	assert.equal(ada.at, 1790000000000);
	assert.match(ada.avatar ?? "", /^data:image\/svg\+xml;base64,/);
	assert.match(Buffer.from(ada.avatar!.split(",")[1]!, "base64").toString(), /<circle/);
	for (const gone of ["resumeRef", "account", "usage", "context", "inPlay", "positions", "lastLine", "stage", "createdAt", "token", "host", "state"]) assert.equal(gone in ada, false, `${gone} is not the people store's`);
});

test("a home canvas the deck no longer has is left out; a string creation time is read; no avatar file, no avatar", async () => {
	const bo = (await migrated()).records.find((r) => r.id.endsWith("002"))!;
	assert.equal(bo.canvas, undefined);
	assert.equal(bo.at, Date.parse("2026-09-20T10:00:00.000Z"));
	assert.equal(bo.avatar, undefined);
	assert.equal(bo.kind, "pi");
});

test("the later of two names the same however capitalised is numbered", async () => {
	const later = (await migrated()).records.find((r) => r.id.endsWith("003"))!;
	assert.equal(later.name, "ada 2");
});

test("today's files stay, and each meta.json and avatar is copied under backups/", async () => {
	const { old } = await migrated();
	const keys = await old.keys("");
	assert.ok(keys.includes("agents/0f3c1a2e-0000-4000-8000-000000000001/chat.log"));
	assert.ok(keys.includes("agents/0f3c1a2e-0000-4000-8000-000000000003/meta.json"));
	const backed = keys.filter((k) => k.startsWith("backups/"));
	assert.ok(backed.some((k) => k.endsWith("agents/0f3c1a2e-0000-4000-8000-000000000001/meta.json")));
	assert.ok(backed.some((k) => k.endsWith("avatars/0f3c1a2e-0000-4000-8000-000000000001.svg")));
	assert.equal(backed.some((k) => k.endsWith("chat.json")), false, "chats are never changed, so never copied");
});

test("it runs once; an agent already in the people store is left as it is", async () => {
	const { deck, old } = fixture();
	const stores = memoryStores();
	await stores("people").put("agents/0f3c1a2e-0000-4000-8000-000000000001", new TextEncoder().encode(JSON.stringify({ id: "0f3c1a2e-0000-4000-8000-000000000001", name: "Kept", color: "#000000", tags: [], at: 1 })));
	const file = memoryVersion('{"version":"0.5.1"}');
	const said = await upgradeDeck(new MemoryDeck(deck), file, undefined, undefined, { stores, old });
	assert.match(said.join(" "), /2 of today's 3/);
	assert.equal((await readJson<PeopleRecord>(stores("people"), "agents/0f3c1a2e-0000-4000-8000-000000000001", undefined as never))!.name, "Kept");
	assert.equal((await readJson<PeopleRecord>(stores("people"), "agents/0f3c1a2e-0000-4000-8000-000000000003", undefined as never))!.name, "ada");
	assert.deepEqual(await upgradeDeck(new MemoryDeck(deck), file, undefined, undefined, { stores, old }), [], "at 0.6.0 nothing runs");
});
