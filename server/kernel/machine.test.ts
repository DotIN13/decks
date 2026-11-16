import { test } from "node:test";
import assert from "node:assert/strict";
import { tempFolder } from "./disk.ts";
import { buildKernel } from "./kernel.ts";
import { MemoryDeck } from "./memory-deck.ts";
import { memoryStores } from "./store.ts";
import { testServer } from "./testing.ts";

// The kernel keeps a machine folder outside any deck and a stable id per deck.

test("the kernel gives a machine folder and a deck id that stays across starts", async () => {
	const server = await testServer();
	assert.match(server.kernel.machine(), /keel-machine-/);
	assert.match(server.kernel.deckId(), /^[0-9a-f-]{36}$/);
	await server.close();
	const stores = memoryStores();
	const machine = await tempFolder("keel-m1");
	try {
		const first = await buildKernel({ deck: new MemoryDeck(), stores, features: [], machine: machine.folder });
		const second = await buildKernel({ deck: new MemoryDeck(), stores, features: [], machine: machine.folder });
		assert.equal(first.kernel.deckId(), second.kernel.deckId());
	} finally {
		await machine.remove();
	}
});

test("an upgrade reads today's leftovers, backs them up, and writes a feature's store before it starts", async () => {
	const { MemoryStore, readJson, writeJson } = await import("./store.ts");
	const { defineFeature } = await import("./types.ts");
	const old = new MemoryStore();
	await writeJson(old, "agents/a1/meta.json", { name: "Ann" });
	let seen: unknown;
	const feature = defineFeature({
		name: "people",
		calls: [],
		async upgrade(_deck, _version, parts) {
			const meta = await readJson(parts.old, "agents/a1/meta.json", {});
			await writeJson(parts.old, "backups/agents/a1/meta.json", meta);
			await writeJson(parts.stores("people"), "agents/a1", meta);
			await assert.rejects(writeJson(parts.old, "agents/a1/meta.json", {}), /only under backups/);
		},
		async start(kernel) {
			seen = await readJson(kernel.store("people"), "agents/a1", undefined);
		},
	});
	const server = await testServer({ features: [feature], old });
	assert.deepEqual(seen, { name: "Ann" });
	assert.deepEqual(await readJson(old, "backups/agents/a1/meta.json", undefined), { name: "Ann" });
	await server.close();
});
