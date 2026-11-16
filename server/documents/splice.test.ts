import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAll, diff, invert, land, transformAll } from "./splice.ts";

// Rule 3: splices move past each other and both ends agree.

test("two writers on one text converge, whichever lands first", () => {
	const base = "the cat sat on the mat";
	const a = [{ at: 4, before: "cat", text: "dog" }];
	const b = [{ at: 19, before: "mat", text: "rug" }, { at: 0, before: "the", text: "a" }];
	const moved = transformAll(a, b, true);
	assert.equal(applyAll(applyAll(base, a)!, moved.b), applyAll(applyAll(base, b)!, moved.a));
	assert.equal(applyAll(applyAll(base, a)!, moved.b), "a dog sat on the rug");
});

test("a key typed inside a word another writer replaced lands after it, not lost", () => {
	const base = "hello world";
	const agent = [{ at: 6, before: "world", text: "there" }];
	const typed = [{ at: 8, before: "", text: "X" }];
	const landed = land(applyAll(base, agent)!, typed, agent);
	assert.equal(landed.refused.length, 0);
	assert.equal(landed.text, "hello thereX");
});

test("without history, a splice that no longer fits is refused by index", () => {
	const landed = land("abc", [{ at: 0, before: "a", text: "A" }, { at: 1, before: "zz", text: "" }], undefined);
	assert.equal(landed.text, "Abc");
	assert.deepEqual(landed.refused, [1]);
});

test("diff turns one text into the other, and invert takes it back", () => {
	const cases = [
		["one\ntwo\nthree\n", "one\n2\nthree\nfour\n"],
		["", "new"],
		["gone", ""],
		["a small step", "a small but sure step"],
		["x\ny\nz", "z\ny\nx"],
	];
	for (const [from, to] of cases) {
		const splices = diff(from!, to!);
		assert.equal(applyAll(from!, splices), to, `${from} -> ${to}`);
		assert.equal(applyAll(to!, invert(splices)), from);
	}
	assert.deepEqual(diff("a small step", "a small but sure step"), [{ at: 8, before: "", text: "but sure " }]);
});
