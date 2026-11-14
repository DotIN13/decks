import assert from "node:assert/strict";
import { test } from "node:test";
import { Live, type LiveSocket } from "./live.ts";
import { MemoryHub } from "./store.ts";

// The live socket: what changes reaches those who may see it, presence never
// goes back to its sender, and a token is asked only of the harness's own socket.

function socket() {
	const one = { sent: [] as Record<string, unknown>[], closed: undefined as [number?, string?] | undefined, message: (_: unknown) => {}, close: () => {} };
	const ws: LiveSocket = {
		send: (t) => void one.sent.push(JSON.parse(t)),
		close: (code, reason) => void (one.closed = [code, reason]),
		on: ((event: string, hear: never) => void (event === "message" ? (one.message = hear) : (one.close = hear))) as LiveSocket["on"],
	};
	return Object.assign(one, { ws, last: () => one.sent[one.sent.length - 1]! });
}

const setup = () => {
	const hub = new MemoryHub();
	const live = new Live(hub);
	const plan = hub.createCanvas("ada", "Plan", "plan");
	hub.share(plan.id, "bob", "view");
	return { hub, live, plan };
};
const ada = { id: "ada", name: "Ada" };
const bob = { id: "bob", name: "Bob" };

test("a socket hears hello, then the changes of the canvases its person may see", () => {
	const { live, plan } = setup();
	const a = socket();
	const b = socket();
	const eve = socket();
	live.add(a.ws, { user: ada });
	live.add(b.ws, { user: bob });
	live.add(eve.ws, { user: { id: "eve", name: "Eve" } });
	assert.deepEqual(a.sent[0], { type: "hello", user: "ada" });
	live.canvasChanged({ id: plan.id, rev: 2, base: 1, by: "ada", changes: [{ op: "meta" }] });
	assert.equal(b.last().type, "canvas");
	assert.equal(b.last().rev, 2);
	assert.equal(eve.sent.length, 1, "nothing for someone who may not see it");
	live.toUser("bob", { type: "harnesses" });
	assert.deepEqual(b.last(), { type: "harnesses" });
	assert.equal(a.sent.length, 2);
});

test("a page's presence reaches the others on its canvas as its person, never its sender, and goes when it closes", () => {
	const { live, plan } = setup();
	const a = socket();
	const b = socket();
	live.add(a.ws, { user: ada });
	live.add(b.ws, { user: bob });
	a.message(JSON.stringify({ type: "presence", canvas: plan.id, pointer: { x: 1, y: 2 } }));
	assert.equal(b.last().type, "presence");
	assert.equal((b.last().by as { name: string }).name, "Ada");
	assert.ok(!a.sent.some((m) => m.type === "presence"));
	a.message(JSON.stringify({ type: "presence", canvas: "c-not-hers", pointer: { x: 1, y: 2 } }));
	assert.equal(b.sent.filter((m) => m.type === "presence").length, 1, "not for a canvas she may not see");
	a.close();
	assert.equal(b.last().gone, true);
});

test("a token is asked of the harness's own socket, and only its answer counts", async () => {
	const { live } = setup();
	const h = socket();
	const other = socket();
	live.add(h.ws, { user: ada, harness: { id: "h-mini", name: "mini" } });
	live.add(other.ws, { user: ada, harness: { id: "h-other", name: "other" } });
	const asked = live.askToken("h-mini", ada, "https://studio.test", 1000);
	const ask = h.last();
	assert.equal(ask.type, "token.ask");
	other.message(JSON.stringify({ type: "token", id: ask.id, token: "forged", expires: 1 }));
	h.message(JSON.stringify({ type: "token", id: ask.id, token: "dk_h_x", expires: 9 }));
	assert.deepEqual(await asked, { token: "dk_h_x", expires: 9 });
	await assert.rejects(live.askToken("h-none", ada, "https://studio.test"), /not connected/);
	await assert.rejects(live.askToken("h-mini", ada, "https://studio.test", 20), /did not answer/);
});

test("a revoked harness's sockets are closed with 4001", () => {
	const { live } = setup();
	const h = socket();
	live.add(h.ws, { user: ada, harness: { id: "h-mini", name: "mini" } });
	live.dropHarness("h-mini");
	assert.deepEqual(h.closed, [4001, "revoked"]);
});
