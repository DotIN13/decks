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

test("retyping the same run twice keeps the last version only", () => {
	const merged = coalesce([
		{ op: "text", id: "goal", text: "Shi" },
		{ op: "text", id: "goal", text: "Ship it" },
	]);
	assert.deepEqual(merged, [{ op: "text", id: "goal", text: "Ship it" }]);
});

test("a card's heading and its body are two runs and both are kept", () => {
	const merged = coalesce([
		{ op: "text", id: "goal", text: "Heading", path: [0] },
		{ op: "text", id: "goal", text: "Body", path: [1] },
	]);
	assert.equal(merged.length, 2);
});

test("only an insert or a duplicate needs the frame reloaded", () => {
	assert.equal(needsReload([{ op: "update", id: "a", style: { left: 1 } }]), false);
	assert.equal(needsReload([{ op: "remove", id: "a" }]), false);
	assert.equal(needsReload([{ op: "duplicate", id: "a" }]), true);
	assert.equal(needsReload([{ op: "insert", kind: "sticky", id: "", at: { left: 0, top: 0 } }]), true);
});
