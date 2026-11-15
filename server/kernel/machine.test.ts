import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
	const machine = join(tmpdir(), "keel-m1");
	const first = await buildKernel({ deck: new MemoryDeck(), stores, features: [], machine });
	const second = await buildKernel({ deck: new MemoryDeck(), stores, features: [], machine });
	assert.equal(first.kernel.deckId(), second.kernel.deckId());
});
