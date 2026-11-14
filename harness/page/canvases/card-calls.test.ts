import assert from "node:assert/strict";
import { test } from "node:test";
import { cardCall, cardMayCall } from "./card-calls.ts";

// A card's call in today's words becomes the new call with one object of arguments.

test("a card may send, queue, list, get and create agents, and go to a canvas; nothing else", () => {
	for (const verb of ["agent.send", "agent.queue", "agent.list", "agent.get", "agent.create", "view.goto"]) assert.ok(cardMayCall(verb), verb);
	assert.equal(cardMayCall("canvas.delete"), false);
	assert.throws(() => cardCall("canvas.delete", []));
});

test("the name and the message become one object", () => {
	assert.deepEqual(cardCall("agent.send", ["Ada", { task: "Option A", cards: ["c"] }]), ["agent.send", { agent: "Ada", task: "Option A", cards: ["c"] }]);
	assert.deepEqual(cardCall("agent.get", ["Bo"]), ["agent.get", { agent: "Bo" }]);
	assert.deepEqual(cardCall("view.goto", ["plan"]), ["view.goto", { canvas: "plan" }]);
});
