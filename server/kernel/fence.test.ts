import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { checkMount } from "./fence.ts";
import { MemoryDeck } from "./memory-deck.ts";
import { testServer } from "./testing.ts";
import type { Deck } from "./types.ts";

// A mount names apps/<name> and a folder that is safe to reach: never a
// relative path, the root, a home folder, a system folder, the deck or a
// hidden folder. The kernel refuses on a deck that cannot mount, and keeps
// a machine folder and a deck id.

test("only apps/<name> may be mounted, and only on a safe folder", () => {
	const deck = "/Users/x/decks/mine";
	const ok = checkMount("apps/notes", "/Users/x/code/notes", deck);
	assert.deepEqual(ok, { prefix: "apps/notes", folder: "/Users/x/code/notes" });
	for (const prefix of ["apps", "apps/a/b", "cards/x", "apps/.hidden"]) assert.throws(() => checkMount(prefix, "/Users/x/code/notes", deck), { code: "invalid" }, prefix);
	const badFolders = ["code/notes", "/", homedir(), join(homedir(), ".."), "/etc/x", "/System/Library", "/usr/local/x", deck, `${deck}/apps/x`, "/Users/x/decks", "/Users/x/.config/app"];
	for (const folder of badFolders) assert.throws(() => checkMount("apps/notes", folder, deck), { code: "invalid" }, folder);
	assert.equal(checkMount("apps/t", join(tmpdir(), "app-x")).folder, join(tmpdir(), "app-x"));
});

test("the kernel mounts through its fence, refuses on a deck that cannot, and keeps a machine folder and deck id", async () => {
	const server = await testServer({ deck: { "apps/local/app.json": "{}" } });
	assert.throws(() => server.kernel.mount("apps/notes", "/etc/notes"), { code: "invalid" });
	server.kernel.mount("apps/notes", join(tmpdir(), "keel-mounted"));
	assert.deepEqual((await server.deck.list("apps" as never)).map((e) => e.path), ["apps/local", "apps/notes"]);
	server.kernel.unmount("apps/notes");
	assert.match(server.kernel.machine(), /keel-machine-/);
	assert.match(server.kernel.deckId(), /^[0-9a-f-]{36}$/);
	await server.close();
	const plain = new MemoryDeck() as Deck;
	const cannot: Deck = { read: plain.read.bind(plain), write: plain.write.bind(plain), list: plain.list.bind(plain), watch: plain.watch.bind(plain), remove: plain.remove.bind(plain), move: plain.move.bind(plain) };
	const studio = await testServer({ deck: cannot });
	assert.throws(() => studio.kernel.mount("apps/notes", join(tmpdir(), "x")), { code: "unavailable" });
	await studio.close();
});

test("the deck id stays the same across starts on the same store", async () => {
	const { buildKernel } = await import("./kernel.ts");
	const { memoryStores } = await import("./store.ts");
	const stores = memoryStores();
	const first = await buildKernel({ deck: new MemoryDeck(), stores, features: [], machine: join(tmpdir(), "keel-m1") });
	const second = await buildKernel({ deck: new MemoryDeck(), stores, features: [], machine: join(tmpdir(), "keel-m1") });
	assert.equal(first.kernel.deckId(), second.kernel.deckId());
});
