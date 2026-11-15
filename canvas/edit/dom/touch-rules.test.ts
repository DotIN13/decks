import assert from "node:assert/strict";
import { test } from "node:test";
import { DRAG_SLOP_BY_POINTER, HANDLE_DOT_PX, HANDLE_HIT_PX, slopFor } from "./touch-rules.ts";

test("the slop is the pointer's: a finger wobbles 8 px, a pen 4, a mouse 3, and an unnamed pointer counts as a mouse", () => {
	assert.equal(slopFor("touch"), 8);
	assert.equal(slopFor("pen"), 4);
	assert.equal(slopFor("mouse"), 3);
	assert.equal(slopFor(""), 3);
	assert.equal(slopFor(undefined), 3);
	assert.deepEqual(DRAG_SLOP_BY_POINTER, { touch: 8, pen: 4, mouse: 3 });
});

test("a handle answers wider than it is drawn: without a touch screen here, a 9 px square answering 15", () => {
	// Node has no matchMedia, so this is the pointer's side of the rule; the touch side is 10 drawn, 44 answered.
	assert.equal(HANDLE_DOT_PX, 9);
	assert.equal(HANDLE_HIT_PX, 15);
});
