import assert from "node:assert/strict";
import { test } from "node:test";
import { watched } from "./line.ts";

// The page's socket asks only for the events the page hears, so others (a frame's pointer, say) never reach it.

test("the socket asks for the names heard, in order", () => {
	assert.deepEqual(watched(["item.changed", "agent.changed", "chat.added"]), ["agent.changed", "chat.added", "item.changed"]);
});

test("one listener for every event asks for them all", () => {
	assert.equal(watched(["item.changed", "*"]), undefined);
});
