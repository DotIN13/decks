import assert from "node:assert/strict";
import { test } from "node:test";
import { isWorking, signPlacement, workingWords } from "./working-sign.ts";

/**
 * Where the working sign goes, and what it says.
 *
 * The placement is one rule read by two components — a pill over the input bar and a card at
 * the foot of the conversation — so the thing worth pinning is that exactly one of them ever
 * has it.
 */
test("idle shows no sign anywhere", () => {
	for (const historyOpen of [false, true]) {
		assert.equal(signPlacement("idle", { historyOpen, arriving: false }), "none");
	}
});

test("with the conversation away, the sign is over the input bar", () => {
	assert.equal(signPlacement("thinking", { historyOpen: false, arriving: false }), "dock");
	assert.equal(signPlacement("tool", { historyOpen: false, arriving: false }), "dock");
	// Even mid-reply: with no column open there is no caret to carry it.
	assert.equal(signPlacement("streaming", { historyOpen: false, arriving: true }), "dock");
});

test("with the conversation open, the column has it and the dock does not", () => {
	assert.equal(signPlacement("thinking", { historyOpen: true, arriving: false }), "column");
	assert.equal(signPlacement("tool", { historyOpen: true, arriving: false }), "column");
});

/*
 * The one case where neither draws it: a reply already on screen, filling in behind a caret.
 * A sign under that card would be a second cursor saying what the first one says.
 */
test("a reply that is already arriving needs no sign at all", () => {
	assert.equal(signPlacement("streaming", { historyOpen: true, arriving: true }), "none");
});

test("waiting for you is a sign but not work in progress", () => {
	assert.equal(signPlacement("waiting", { historyOpen: false, arriving: false }), "dock");
	assert.equal(signPlacement("waiting", { historyOpen: true, arriving: false }), "column");
	assert.equal(isWorking("waiting"), false, "so the mark stands still");
	assert.equal(workingWords("waiting", "Marin"), "Marin is waiting for you", "and the words name whose move it is");
});

test("three states, three distinct words", () => {
	const said = (["thinking", "streaming", "tool"] as const).map((state) => workingWords(state, "Marin"));
	assert.deepEqual(said, ["working…", "typing…", "running tools…"]);
	assert.equal(new Set(said).size, 3, "the state where an answer is arriving is not the state where nothing is");
	for (const state of ["thinking", "streaming", "tool"] as const) assert.equal(isWorking(state), true);
});
