import assert from "node:assert/strict";
import { test } from "node:test";
import { menuLeft } from "./menu-place.ts";

// A pill's ⋯ menu hangs under its button, and stays inside the canvas.

test("the menu sits 4 px left of the button", () => {
	assert.equal(menuLeft({ left: 0, right: 1000 }, { left: 300 }, { left: 400 }, 160), 96);
});

test("near the canvas's right edge it moves left, near its left edge right, keeping 8 px", () => {
	assert.equal(menuLeft({ left: 0, right: 1000 }, { left: 800 }, { left: 950 }, 160), 32);
	assert.equal(menuLeft({ left: 0, right: 1000 }, { left: -20 }, { left: -10 }, 160), 28);
});
