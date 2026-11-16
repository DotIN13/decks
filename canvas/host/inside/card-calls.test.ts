import assert from "node:assert/strict";
import { test } from "node:test";
import { cardCalls } from "./card-calls.ts";

// A card's calls in the frame, old shape and new: where each goes, as which call, and what is refused.

const CARD = "canvases/plan/cards/one/index.html";

function frame(answer: unknown = []) {
	const sent: Array<{ to: "socket" | "page"; name: string; args: Record<string, unknown> }> = [];
	const call = cardCalls({
		canvas: "plan",
		camera: () => ({ x: 1, y: 2, zoom: 1 }),
		move: () => {},
		focus: () => {},
		viewport: () => ({ width: 800, height: 600 }),
		reload: () => {},
		harness: async (name, args) => (sent.push({ to: "socket", name, args }), { ok: true, value: answer }),
		page: async (name, args) => (sent.push({ to: "page", name, args }), { ok: true }),
	});
	return { call: (verb: string, ...args: unknown[]) => call(verb, args, CARD), sent };
}

test("agent.send in the new shape goes to the page as it is", async () => {
	const { call, sent } = frame();
	await call("agent.send", { agent: "Mason", task: "Option A" });
	assert.deepEqual(sent, [{ to: "page", name: "agent.send", args: { agent: "Mason", task: "Option A" } }]);
});

test("agent.send in the old shape (a decision button) goes to the page as the new call", async () => {
	const { call, sent } = frame();
	await call("agent.send", "Mason", { task: "Option A", cards: [CARD] });
	assert.equal(sent[0]?.to, "page");
	assert.equal(sent[0]?.name, "agent.send");
	assert.equal(sent[0]?.args.agent, "Mason");
	assert.equal(sent[0]?.args.task, "Option A");
});

test("a migrated board's stage.send (agent.queue with boards) goes to the page as agent.queue", async () => {
	const { call, sent } = frame();
	await call("agent.queue", "Mason", { task: "Pressed", boards: [CARD] });
	assert.equal(sent[0]?.to, "page");
	assert.equal(sent[0]?.name, "agent.queue");
	assert.equal(sent[0]?.args.agent, "Mason");
	assert.equal(sent[0]?.args.task, "Pressed");
});

test("an old canvas.delete('note-1') deletes the item, never a canvas", async () => {
	const { call, sent } = frame({ deleted: "note-1" });
	await call("canvas.delete", "note-1");
	assert.equal(sent[0]?.name, "item.delete");
	assert.equal(sent[0]?.args.id, "note-1");
});

test("an old canvas.read answers its old shape, the items under items", async () => {
	const { call, sent } = frame([{ type: "note", id: "n" }]);
	const answer = await call("canvas.read");
	assert.equal(sent[0]?.name, "item.list");
	assert.deepEqual(answer, { items: [{ type: "note", id: "n" }] });
});

test("old view.camera and now are answered in the frame", async () => {
	const { call, sent } = frame();
	assert.deepEqual(await call("view.camera"), { x: 1, y: 2, zoom: 1 });
	assert.equal(typeof ((await call("now")) as { iso?: unknown }).iso, "string");
	assert.equal(sent.length, 0);
});

test("a card may not delete a canvas, start an agent or reach another canvas, by either shape", async () => {
	const { call, sent } = frame();
	await assert.rejects(call("canvas.delete", { canvas: "plan" }));
	await assert.rejects(call("agent.create", { name: "Spy" }));
	await assert.rejects(call("agent.create", { name: "Spy", kind: "pi" }));
	await assert.rejects(call("item.list", { canvas: "other" }));
	assert.equal(sent.filter((one) => one.name === "canvas.delete" || one.name === "agent.create").length, 0);
});
