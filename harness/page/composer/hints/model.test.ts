import assert from "node:assert/strict";
import { test } from "node:test";
import { hintSet, queueKey } from "./model.ts";

// The hints under the box, and the queue key.

test("the queue key is Command on a Mac and Control elsewhere", () => {
	assert.equal(queueKey("MacIntel"), "⌘");
	assert.equal(queueKey("Win32"), "Ctrl");
});

test("an open menu's keys win over sending, and a busy agent steers", () => {
	assert.equal(hintSet({ menuOpen: true, busy: true }), "menu");
	assert.equal(hintSet({ menuOpen: false, busy: true }), "busy");
	assert.equal(hintSet({ menuOpen: false }), "idle");
});
