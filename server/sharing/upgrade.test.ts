import assert from "node:assert/strict";
import { test } from "node:test";
import { readBase, readLink, readState } from "./client/link.ts";
import { memoryStore } from "./testing.ts";
import { upgradeSharing } from "./upgrade.ts";

// Rule 16: today's link, sync state and agreed drawings are carried, never over what is there.

const enc = (value: unknown) => new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));
const pen = '{"version":"2.14","children":[{"id":"n1","type":"note","content":"hi","x":0,"y":0}]}';

function oldDeck() {
	const old = memoryStore();
	old.kept.set("studio.json", enc({ url: "https://studio.test", key: "dsk_1" }));
	old.kept.set("studio-sync.json", enc({ studio: "https://studio.test", user: "ada", canvases: {
		plan: { id: "c1", rev: 4, files: { "cards/a/index.html": { version: 2, hash: "h" } } },
		"shared/bob/notes": { id: "c2", rev: 1, pen, files: {} },
		"../bad": { id: "c3", rev: 1, files: {} },
	} }));
	old.kept.set("sync/c1.pen", enc(pen));
	return old;
}

test("the link, the state by folder and each agreed drawing are carried", async () => {
	const store = memoryStore();
	const said: string[] = [];
	await upgradeSharing(oldDeck(), store, (line) => said.push(line));
	assert.deepEqual(await readLink(store), { url: "https://studio.test", key: "dsk_1" });
	const state = await readState(store);
	assert.equal(state.user, "ada");
	assert.deepEqual(Object.keys(state.canvases).sort(), ["canvases/plan", "shared/canvases/bob/notes"], "a bad name is left behind");
	assert.deepEqual(state.canvases["canvases/plan"], { id: "c1", rev: 4, files: { "cards/a/index.html": { version: 2, hash: "h" } } });
	assert.equal((await readBase(store, "c1"))?.children?.length, 1, "from sync/<id>.pen");
	assert.equal((await readBase(store, "c2"))?.children?.length, 1, "from the older copy in the state");
	assert.equal(said.length, 2);
});

test("what the new store holds is never overwritten, and a deck with no Studio carries nothing", async () => {
	const store = memoryStore();
	store.kept.set("link", enc({ url: "https://new.test", key: "dsk_2" }));
	await upgradeSharing(oldDeck(), store);
	assert.equal((await readLink(store))?.url, "https://new.test");
	const none = memoryStore();
	await upgradeSharing(memoryStore(), none);
	assert.equal(none.kept.size, 0);
});
