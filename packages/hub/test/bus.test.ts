import { test } from "node:test";
import assert from "node:assert/strict";
import { Live, MemoryBus, MemoryStore, NotConnected, type LiveSocket } from "../src/index.ts";

/*
 * Two Lives on one bus, as two processes would be: what one says reaches the other's sockets, presence
 * crosses, a harness token is asked of a socket in the other process, and a drop closes there too.
 */
const store = new MemoryStore();
const ada = { id: "ada", name: "Ada" };
const bob = { id: "bob", name: "Bob" };
const launch = store.createCanvas("ada", "Launch", "launch");
store.share(launch.id, "bob", "view");

/** A fake socket: what it was sent, and the listeners the Live put on it. */
function socket() {
	const one = { sent: [] as string[], closed: undefined as [number?, string?] | undefined, message: undefined as ((d: unknown) => void) | undefined, close: undefined as (() => void) | undefined };
	const ws: LiveSocket = { send: (t) => one.sent.push(t), close: (code, reason) => (one.closed = [code, reason]), on: ((event: string, listener: (d?: unknown) => void) => void (event === "message" ? (one.message = listener) : (one.close = listener as () => void))) as never };
	return { ...one, ws, get last() { return JSON.parse(one.sent[one.sent.length - 1]!) as Record<string, unknown>; }, get all() { return one.sent.map((t) => JSON.parse(t) as Record<string, unknown>); }, get sent() { return one.sent; }, get closed() { return one.closed; }, get message() { return one.message; } };
}
const tick = () => new Promise((r) => setTimeout(r, 5));

test("what one process says reaches the other's sockets, once, and never comes back", async () => {
	const bus = new MemoryBus();
	const a = new Live(store, { bus });
	const b = new Live(store, { bus });
	const adaOnA = socket();
	const bobOnB = socket();
	const frameOnB = socket();
	a.add(adaOnA.ws, { user: ada });
	b.add(bobOnB.ws, { user: bob });
	b.add(frameOnB.ws, { user: bob, only: launch.id });
	const before = [adaOnA.sent.length, bobOnB.sent.length, frameOnB.sent.length];

	a.toCanvas(launch.id, { type: "canvases" });
	await tick();
	assert.equal(adaOnA.sent.length, before[0]! + 1, "the sender's own socket, as before");
	assert.equal(bobOnB.sent.length, before[1]! + 1, "and the other process's");
	assert.equal(frameOnB.sent.length, before[2]! + 1, "its frame too, held to this canvas");
	assert.deepEqual(bobOnB.last, { type: "canvases" });

	a.toUser("bob", { type: "harnesses" });
	await tick();
	assert.deepEqual(bobOnB.last, { type: "harnesses" });
	assert.equal(frameOnB.sent.length, before[2]! + 1, "not to a socket held to one canvas");
	assert.equal(adaOnA.sent.length, before[0]! + 1, "nothing for Ada");

	a.canvasChanged({ id: launch.id, rev: 2, base: 1, by: "ada", changes: [{ op: "meta" }] });
	await tick();
	assert.equal(bobOnB.last.type, "canvas");
	assert.equal(bobOnB.last.rev, 2);
	// Nothing is said twice: the bus's copy is not published again.
	await tick();
	assert.equal(bobOnB.sent.length, before[1]! + 3);
});

test("presence crosses, with the sender left out on its own process", async () => {
	const bus = new MemoryBus();
	const a = new Live(store, { bus });
	const b = new Live(store, { bus });
	const adaOnA = socket();
	const bobOnB = socket();
	a.add(adaOnA.ws, { user: ada });
	b.add(bobOnB.ws, { user: bob });
	const before = bobOnB.sent.length;
	adaOnA.message!(JSON.stringify({ type: "presence", canvas: launch.id, pointer: { x: 1, y: 2 } }));
	await tick();
	assert.equal(bobOnB.sent.length, before + 1);
	assert.equal(bobOnB.last.type, "presence");
	assert.deepEqual((bobOnB.last.by as { name: string }).name, "Ada");
	assert.ok(!adaOnA.sent.some((t) => t.includes('"presence"')), "never to the sender");
});

test("a harness token is asked of a socket in the other process, and the answer comes back; nobody with it fails in time", async () => {
	const bus = new MemoryBus();
	const a = new Live(store, { bus });
	const b = new Live(store, { bus });
	const harnessOnB = socket();
	b.add(harnessOnB.ws, { user: ada, harness: { id: "h-mini", name: "mini" } });
	const asked = a.askToken("h-mini", ada, "https://studio.test", 500);
	await tick();
	const ask = harnessOnB.last as { type: string; id: string; origin: string };
	assert.equal(ask.type, "token.ask");
	assert.equal(ask.origin, "https://studio.test");
	harnessOnB.message!(JSON.stringify({ type: "token", id: ask.id, token: "dk_h_x", expires: 9 }));
	assert.deepEqual(await asked, { token: "dk_h_x", expires: 9 });
	// A refusal crosses as its sentence.
	const refused = a.askToken("h-mini", ada, "https://studio.test", 500);
	await tick();
	harnessOnB.message!(JSON.stringify({ type: "token", id: (harnessOnB.last as { id: string }).id, error: "not for you" }));
	await assert.rejects(refused, /not for you/);
	// No process has the harness: the asker runs out. (The ask's timer does not keep the process alive; this does.)
	const alive = setInterval(() => {}, 10);
	try {
		await assert.rejects(a.askToken("h-other", ada, "https://studio.test", 30), NotConnected);
	} finally {
		clearInterval(alive);
	}
	// Without a bus, the old answer at once.
	await assert.rejects(new Live(store).askToken("h-mini", ada, "https://studio.test"), /not connected/);
});

test("a drop closes the sockets in every process", async () => {
	const bus = new MemoryBus();
	const a = new Live(store, { bus });
	const b = new Live(store, { bus });
	const harnessOnB = socket();
	const bobOnB = socket();
	const bobOnA = socket();
	b.add(harnessOnB.ws, { user: ada, harness: { id: "h-mini", name: "mini" } });
	b.add(bobOnB.ws, { user: bob });
	a.add(bobOnA.ws, { user: bob });
	a.dropHarness("h-mini");
	await tick();
	assert.deepEqual(harnessOnB.closed, [4001, "revoked"]);
	assert.equal(bobOnB.closed, undefined);
	a.dropUser("bob");
	await tick();
	assert.deepEqual(bobOnA.closed, [4001, "account deleted"]);
	assert.deepEqual(bobOnB.closed, [4001, "account deleted"]);
});
