import assert from "node:assert/strict";
import { test } from "node:test";
import { faceStyle, initialOf } from "./model.ts";

// A face shows the agent's first letter in its colour, and no colour behind a drawn avatar.

test("the letter is the identity's first, else the row's name", () => {
	assert.equal(initialOf({ name: "ada", color: "#f00" }, "x"), "A");
	assert.equal(initialOf(undefined, "bo"), "B");
});

test("the fill is the colour, transparent behind an avatar, the accent when unknown", () => {
	assert.equal(faceStyle({ name: "A", color: "#f00" })["--fill"], "#f00");
	assert.equal(faceStyle({ name: "A", color: "#f00", avatar: "/a.svg" })["--fill"], "transparent");
	assert.equal(faceStyle(undefined, 20, 1.5)["--face"], "20px");
});
