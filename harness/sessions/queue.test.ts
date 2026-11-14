import assert from "node:assert/strict";
import { test } from "node:test";
import { Queues, QUEUE_LIMIT, type Mail } from "./queue.ts";

// README rules 5 and 6, from the sentences.

function rig() {
	const said: string[] = [];
	const ran: Mail[] = [];
	let idle = true;
	let changes = 0;
	const queues = new Queues({ idle: () => idle, prompt: (text) => void said.push(text), run: async (mail) => void ran.push(mail), changed: () => void changes++ });
	return { queues, said, ran, busy: () => (idle = false), free: () => (idle = true), changes: () => changes };
}

const mail = (id: string): Mail => ({ id, from: "Ada", task: `task ${id}`, cards: [] });

test("added while idle and empty, a message is sent at once", () => {
	const r = rig();
	r.queues.add("hello");
	assert.deepEqual(r.said, ["hello"]);
	assert.equal(r.queues.view().items.length, 0);
});

test("added while working, it waits, and the next one goes when the turn ends", () => {
	const r = rig();
	r.busy();
	r.queues.add("one");
	r.queues.add("two");
	assert.deepEqual(r.said, []);
	r.free();
	r.queues.turnEnded();
	assert.deepEqual(r.said, ["one"]);
	assert.deepEqual(r.queues.view().items.map((i) => i.text), ["two"]);
});

test("stopping holds the queue; releasing sends the next; removing the last releases it", () => {
	const r = rig();
	r.busy();
	r.queues.add("one");
	r.queues.add("two");
	r.queues.hold();
	r.free();
	r.queues.turnEnded();
	assert.deepEqual(r.said, [], "held: nothing goes at the end of a turn");
	assert.equal(r.queues.view().held, true);
	r.queues.release();
	assert.deepEqual(r.said, ["one"]);
	r.queues.hold();
	r.queues.remove(r.queues.view().items[0]!.id);
	assert.equal(r.queues.view().held, false);
});

test("send now takes one item out of turn", () => {
	const r = rig();
	r.busy();
	r.queues.add("one");
	r.queues.add("two");
	r.queues.sendNow(r.queues.view().items[1]!.id);
	assert.deepEqual(r.said, ["two"]);
});

test("queued mail runs after the quiet wait, behind the person's own", async () => {
	process.env.DECKS_QUEUE_IDLE_MS = "20";
	const r = rig();
	r.busy();
	r.queues.add("mine");
	r.queues.mail(mail("a"));
	r.free();
	r.queues.turnEnded();
	assert.deepEqual(r.said, ["mine"]);
	await new Promise((done) => setTimeout(done, 60));
	assert.equal(r.ran.length, 0, "the person's message is still the agent's turn");
	r.queues.turnEnded();
	await new Promise((done) => setTimeout(done, 60));
	assert.deepEqual(r.ran.map((m) => m.id), ["a"]);
});

test("at most eight items wait; a ninth is refused", () => {
	const r = rig();
	r.busy();
	for (let i = 0; i < QUEUE_LIMIT; i++) r.queues.mail(mail(String(i)));
	assert.throws(() => r.queues.mail(mail("x")), (e: { code?: string }) => e.code === "conflict");
	assert.equal(r.queues.length, QUEUE_LIMIT);
});
