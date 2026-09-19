import assert from "node:assert/strict";
import { test } from "node:test";
import { watchedBeingNamed } from "./watching.ts";

const NOW = 1_700_000_000_000;

const act = { lastWrittenBy: "a1", namedAt: NOW - 1000, seenAt: undefined as number | undefined };

test("a board named by the agent on screen was watched being named", () => {
	assert.equal(watchedBeingNamed(act, { surface: "stage", focused: "a1" }), true);
});

test("the same act read anywhere else is news", () => {
	assert.equal(watchedBeingNamed(act, { surface: "dispatch" }), false, "looking at the dashboard");
	assert.equal(watchedBeingNamed(act, { surface: "stage", focused: "b2" }), false, "another agent's stage");
	assert.equal(watchedBeingNamed(act, { surface: "stage" }), false, "no conversation open");
});

test("a file event is not an act, and the person's own act is not theirs to be told about", () => {
	assert.equal(watchedBeingNamed({ lastWrittenBy: "a1" }, { surface: "stage", focused: "a1" }), false);
	assert.equal(watchedBeingNamed({ ...act, lastWrittenBy: "you" }, { surface: "stage", focused: "you" }), false);
});

test("an act already read is not said again", () => {
	assert.equal(watchedBeingNamed({ ...act, seenAt: NOW }, { surface: "stage", focused: "a1" }), false);
	assert.equal(watchedBeingNamed({ ...act, seenAt: NOW - 2000 }, { surface: "stage", focused: "a1" }), true);
});
