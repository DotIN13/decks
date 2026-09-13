import assert from "node:assert/strict";
import { test } from "node:test";
import { coalesce, needsReload } from "./patches.ts";

/**
 * What a burst of inspector clicks must not become: a patch per click, each composed
 * against a revision the one before it replaced, each refused with a warning.
 */

test("consecutive updates to one component are one update", () => {
	const merged = coalesce([
		{ op: "update", id: "note", style: { left: 40 } },
		{ op: "update", id: "note", style: { left: 48, top: 80 } },
		{ op: "update", id: "note", class: "callout" },
		{ op: "update", id: "note", attrs: { "data-tone": "warn" } },
		{ op: "update", id: "note", attrs: { "data-tone": "danger" } },
	]);
	assert.deepEqual(merged, [
		{ op: "update", id: "note", style: { left: 48, top: 80 }, class: "callout", attrs: { "data-tone": "danger" } },
	]);
});

test("a null in attrs survives the merge, because it is a removal and not an absence", () => {
	const merged = coalesce([
		{ op: "update", id: "note", attrs: { "data-tone": "warn" } },
		{ op: "update", id: "note", attrs: { "data-tone": null } },
	]);
	assert.deepEqual(merged, [{ op: "update", id: "note", attrs: { "data-tone": null } }]);
});

test("updates to different components stay separate, in order", () => {
	const merged = coalesce([
		{ op: "update", id: "a", style: { left: 8 } },
		{ op: "update", id: "b", style: { left: 8 } },
		{ op: "update", id: "a", style: { top: 8 } },
	]);
	assert.equal(merged.length, 3);
});

test("nothing merges across an op that is not an update", () => {
	// A remove between two updates would change what the second update applies to.
	const merged = coalesce([
		{ op: "update", id: "a", style: { left: 8 } },
		{ op: "remove", id: "b" },
		{ op: "update", id: "a", style: { top: 8 } },
	]);
	assert.deepEqual(
		merged.map((patch) => patch.op),
		["update", "remove", "update"],
	);
});

/*
 * And the merge keeps the *first* `before`, which is the half that is easy to get wrong.
 *
 * `before` says what the file is expected to hold, and the file has seen none of the edits
 * in a burst. A→B then B→C is A→C; a merged patch claiming the file says `B` would be
 * refused by the very guard that exists to catch a real race with the agent.
 */
test("retyping the same run twice keeps the last version and the original before", () => {
	const merged = coalesce([
		{ op: "text", id: "goal", path: [0], before: "Ship", text: "Shi" },
		{ op: "text", id: "goal", path: [0], before: "Shi", text: "Ship it" },
	]);
	assert.deepEqual(merged, [{ op: "text", id: "goal", path: [0], before: "Ship", text: "Ship it" }]);
});

test("a card's heading and its body are two runs and both are kept", () => {
	// One id and two paths, so the comparison is of both halves of the address.
	const merged = coalesce([
		{ op: "text", id: "goal", path: [0], before: "a", text: "Heading" },
		{ op: "text", id: "goal", path: [1], before: "b", text: "Body" },
	]);
	assert.equal(merged.length, 2);
});

test("the same indices under different components are different runs", () => {
	const merged = coalesce([
		{ op: "text", id: "goal", path: [0], before: "a", text: "One" },
		{ op: "text", id: "risk", path: [0], before: "b", text: "Two" },
	]);
	assert.equal(merged.length, 2);
});

test("a path of a different depth is a different run, not a longer one", () => {
	const merged = coalesce([
		{ op: "text", id: "goal", path: [], before: "a", text: "One" },
		{ op: "text", id: "goal", path: [0], before: "b", text: "Two" },
	]);
	assert.equal(merged.length, 2);
});

test("a rich run and a plain source are different payloads and never merge", () => {
	// Same component, same path, different op: one is a `[data-md]` panel's source and the
	// other a paragraph's markup, and merging them would send one as the other.
	const merged = coalesce([
		{ op: "text", id: "notes", path: [], before: "a", text: "## a" },
		{ op: "html", id: "notes", path: [], before: "a", html: "<b>a</b>" },
	]);
	assert.equal(merged.length, 2);
});

test("two edits to the same rich run merge, keeping the original before", () => {
	const merged = coalesce([
		{ op: "html", id: "intro", path: [0], before: "See the doc", html: "See <b>the</b> doc" },
		{ op: "html", id: "intro", path: [0], before: "See the doc", html: "See <b>the doc</b>" },
	]);
	assert.deepEqual(merged, [{ op: "html", id: "intro", path: [0], before: "See the doc", html: "See <b>the doc</b>" }]);
});

test("only an insert or a duplicate needs the frame reloaded", () => {
	assert.equal(needsReload([{ op: "update", id: "a", style: { left: 1 } }]), false);
	assert.equal(needsReload([{ op: "remove", id: "a" }]), false);
	assert.equal(needsReload([{ op: "duplicate", id: "a" }]), true);
	assert.equal(needsReload([{ op: "insert", kind: "sticky", id: "", at: { left: 0, top: 0 } }]), true);
});
