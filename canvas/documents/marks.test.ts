import assert from "node:assert/strict";
import { test } from "node:test";
import { marksOf, segments, shiftMarks, spliceBetween } from "./marks.ts";

test("a suggestion's marks follow typing around them, and typing at their edges stays out", () => {
	let marks = marksOf("c", [{ at: 4, before: "big", text: "small" }]);
	assert.deepEqual(marks, [
		{ change: "c", kind: "del", at: 4, text: "big" },
		{ change: "c", kind: "ins", start: 4, end: 9 },
	]);
	// Typing right after the suggestion, and right before it.
	marks = shiftMarks(marks, { at: 9, before: "", text: "!" });
	marks = shiftMarks(marks, { at: 4, before: "", text: "very " });
	assert.deepEqual(marks.find((m) => m.kind === "ins"), { change: "c", kind: "ins", start: 9, end: 14 });
	// Deleting the suggested words takes their mark away.
	assert.equal(shiftMarks(marks, { at: 9, before: "small", text: "" }).filter((m) => m.kind === "ins").length, 0);
});

test("the text is cut into plain runs, suggested runs and ghosts, in order", () => {
	const text = "The effect is small.";
	const marks = marksOf("c", [{ at: 14, before: "big", text: "small" }]);
	assert.deepEqual(
		segments(text, marks).map((s) => ("mark" in s ? `[${s.mark.kind}:${s.text || (s.mark.kind === "del" ? s.mark.text : "")}]` : s.text)),
		["The effect is ", "[del:big]", "[ins:small]", "."],
	);
	assert.equal(segments(text, marks).map((s) => s.text).join(""), text, "the runs put together are the text exactly");
});

test("a keystroke becomes one splice where the caret says it was typed", () => {
	assert.deepEqual(spliceBetween("aa", "aaa", 1), { at: 0, before: "", text: "a" });
	assert.deepEqual(spliceBetween("aa", "aaa", 3), { at: 2, before: "", text: "a" });
	assert.deepEqual(spliceBetween("hello world", "hello  world", 6), { at: 5, before: "", text: " " });
	assert.deepEqual(spliceBetween("hello world", "hello", 5), { at: 5, before: " world", text: "" });
	assert.equal(spliceBetween("same", "same", 2), undefined);
});
