import assert from "node:assert/strict";
import { test } from "node:test";
import { numberedName } from "./names.ts";

/*
 * What a thing is called before anybody names it. The point of the number is that it is
 * unique — an agent is addressed by `@name` and a canvas is joined by name — so the cases
 * worth pinning are the counting, and what it does with a number already in use.
 */

test("the first of anything is number one", () => {
	for (const base of ["Agent", "Canvas"]) assert.equal(numberedName(base, () => false), `${base} 1`);
});

test("they count up, and no two share a number", () => {
	const made = new Set<string>();
	for (let n = 0; n < 5; n += 1) made.add(numberedName("Agent", (candidate) => made.has(candidate)));
	assert.deepEqual([...made], ["Agent 1", "Agent 2", "Agent 3", "Agent 4", "Agent 5"]);
});

test("a number that is free again is used again, rather than counting past it", () => {
	// Three canvases with the second deleted: the next one is `Canvas 2`, because the number
	// is what a person counting the rooms in front of them sees, not how many there have been.
	const here = new Set(["Canvas 1", "Canvas 3"]);
	assert.equal(numberedName("Canvas", (name) => here.has(name)), "Canvas 2");
});

test("an empty base is an Agent, and nothing is called just a number", () => {
	assert.equal(numberedName("   ", () => false), "Agent 1");
});
