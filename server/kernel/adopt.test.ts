import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { MemoryStore, memoryStores, writeJson } from "./store.ts";
import { tempFolder } from "./disk.ts";
import { buildKernel } from "./kernel.ts";
import { MemoryDeck } from "./memory-deck.ts";
import { testServer } from "./testing.ts";
import { toDeckPath } from "./types.ts";

// A deck from today's server keeps its paired logins and its card versions:
// tokens.json v2 becomes the kernel's tokens, revisions/ becomes history at
// negative revisions, oldest lowest; once per deck.

const enc = (text: string) => new TextEncoder().encode(text);
const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");

async function oldDeck(): Promise<MemoryStore> {
	const old = new MemoryStore();
	await writeJson(old, "tokens.json", {
		v: 2,
		tokens: [
			{ id: "aa11", hash: hashOf("dk_tab"), principal: { kind: "person" }, label: "Decks tab", at: 1 },
			{ id: "bb22", hash: hashOf("dk_agent"), principal: { kind: "agent", id: "a_1" }, at: 2 },
			{ id: "cc33", hash: hashOf("dk_pass"), principal: { kind: "canvas", canvas: "x", role: "edit" }, at: 3 },
		],
	});
	await writeJson(old, "revisions/index.json", { "canvases/a/cards/x/index.html": [{ sha: "s1", at: 10 }, { sha: "s2", at: 30 }], "canvases/b/cards/y/index.html": [{ sha: "s3", at: 20 }] });
	for (const [sha, text] of [["s1", "one"], ["s2", "two"], ["s3", "other"]] as const) await old.put(`revisions/${sha}.html`, enc(text));
	return old;
}

test("paired tokens are kept as callers, canvas passes are not, and card versions become history", async () => {
	const machine = await tempFolder("keel-adopt");
	const stores = memoryStores();
	try {
		const built = await buildKernel({ deck: new MemoryDeck(), stores, features: [], machine: machine.folder, old: await oldDeck() });
		assert.deepEqual(built.callers.resolve("dk_tab"), { kind: "person", id: "pair-aa11", name: "Decks tab" });
		assert.equal(built.callers.resolve("dk_agent")?.id, "a_1");
		assert.equal(built.callers.resolve("dk_pass"), undefined);
		const card = toDeckPath("canvases/a/cards/x/index.html");
		assert.deepEqual((await built.history.revisions(card)).map((one) => one.rev), [-3, -1]);
		assert.equal(new TextDecoder().decode(await built.history.readAt(card, -2)), "one");
		assert.equal(new TextDecoder().decode(await built.history.readAt(card, -1)), "two");
		await built.stop();
		const again = await buildKernel({ deck: new MemoryDeck(), stores, features: [], machine: machine.folder, old: await oldDeck() });
		assert.equal((await again.history.revisions(card)).length, 2);
		await again.stop();
	} finally {
		await machine.remove();
	}
});

test("a deck with nothing of today's opens as before", async () => {
	const server = await testServer({ old: new MemoryStore() });
	assert.equal((await server.value<{ protocol: string }>("deck.get")).protocol.length > 0, true);
	await server.close();
});
