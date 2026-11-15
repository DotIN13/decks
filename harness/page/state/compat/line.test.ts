import assert from "node:assert/strict";
import { test } from "node:test";
import { oldFrame, oldLineUrl } from "./line.ts";

// In compat mode the page sends today's calls in today's frame, on today's line.

test("today's line sits beside the server, on ws", () => {
	assert.equal(oldLineUrl("http://127.0.0.1:4682"), "ws://127.0.0.1:4682/compat/v1/socket");
});

test("a call is today's line.call: id, verb and positional arguments", () => {
	assert.deepEqual(JSON.parse(oldFrame("o1", "agent.set", ["a3", { name: "Iris" }])), { type: "line.call", id: "o1", verb: "agent.set", args: ["a3", { name: "Iris" }] });
});
