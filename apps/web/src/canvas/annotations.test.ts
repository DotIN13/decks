import assert from "node:assert/strict";
import { test } from "node:test";
import { anchorPoint, bubbleSide, cleanMarks, MAX_LABEL, MAX_MARKS } from "./annotations.ts";

/*
 * Two kinds of case. What an agent may send — it will send a sentence, an unknown tone, five
 * at once, and a `to` that is neither a string nor a point — and where the arrow lands, which
 * is the part that goes wrong silently: an arrow through the middle of the words it is
 * pointing at, or a bubble hanging off the right edge of the board.
 */

test("a mark needs somewhere to point and something to say", () => {
	assert.deepEqual(cleanMarks("a", "boards/plan.html", { to: "goal", label: "added a step" }), [
		{ agentId: "a", path: "boards/plan.html", to: "goal", label: "added a step", tone: "accent" },
	]);
	assert.deepEqual(cleanMarks("a", "b", { to: "goal" }), [], "no label is nothing to draw");
	assert.deepEqual(cleanMarks("a", "b", { label: "look" }), [], "no anchor is nowhere to draw it");
	assert.deepEqual(cleanMarks("a", "b", { to: "  ", label: "look" }), []);
});

test("an anchor is a data-id or a point, and nothing else", () => {
	assert.deepEqual(cleanMarks("a", "b", { to: { x: 10, y: 20 }, label: "here" })[0]?.to, { x: 10, y: 20 });
	assert.deepEqual(cleanMarks("a", "b", { to: { x: 10 }, label: "here" }), [], "half a point is not a point");
	assert.deepEqual(cleanMarks("a", "b", { to: { x: NaN, y: 2 }, label: "here" }), []);
	assert.deepEqual(cleanMarks("a", "b", { to: 7, label: "here" }), []);
});

test("one mark or a list, and the same shape either way", () => {
	assert.equal(cleanMarks("a", "b", { to: "x", label: "one" }).length, 1);
	assert.equal(cleanMarks("a", "b", [{ to: "x", label: "one" }, { to: "y", label: "two" }]).length, 2);
});

test("four at most; past that they overlap and say nothing", () => {
	const many = Array.from({ length: 9 }, (_, i) => ({ to: `c${i}`, label: `n${i}` }));
	assert.equal(cleanMarks("a", "b", many).length, MAX_MARKS);
	assert.equal(cleanMarks("a", "b", many)[0]?.label, "n0", "the first four, which is the agent's own priority");
});

test("a bad one is dropped rather than failing the call", () => {
	// An agent that got one of four wrong has still said three true things.
	const mixed = [{ to: "a", label: "kept" }, { label: "no anchor" }, { to: "b" }, { to: "c", label: "also kept" }];
	assert.deepEqual(cleanMarks("x", "b", mixed).map((mark) => mark.label), ["kept", "also kept"]);
	assert.deepEqual(cleanMarks("x", "b", null), [], "nothing at all is nothing to draw");
	assert.deepEqual(cleanMarks("x", "b", "look here"), [], "a bare string is not a mark");
});

test("a long label is cut, and an unknown tone falls back to accent", () => {
	const long = cleanMarks("a", "b", { to: "x", label: "y".repeat(200) })[0];
	assert.equal(long?.label.length, MAX_LABEL);
	assert.equal(cleanMarks("a", "b", { to: "x", label: "l", tone: "chartreuse" })[0]?.tone, "accent");
	assert.equal(cleanMarks("a", "b", { to: "x", label: "l", tone: "danger" })[0]?.tone, "danger");
});

test("the arrow lands on a component's right edge, a third of the way down", () => {
	/*
	 * Not the centre: an arrow into the middle of a card covers the words it is pointing at.
	 * A third down is beside the heading, which is what a reader looks at first.
	 */
	/* A plain object, deliberately: `anchorPoint` duck-types rather than using `instanceof`,
	   because a board is an iframe and its elements belong to that realm's `HTMLElement`. */
	const doc = {
		querySelector: () => ({ offsetLeft: 48, offsetTop: 100, offsetWidth: 400, offsetHeight: 300 }),
	} as unknown as Document;
	assert.deepEqual(anchorPoint(doc, "goal"), { x: 448, y: 200 });
});

test("…and a point is taken as given, with no document needed", () => {
	assert.deepEqual(anchorPoint(undefined, { x: 5, y: 6 }), { x: 5, y: 6 });
});

test("a data-id the board no longer has draws nothing", () => {
	// An agent can annotate a component and then delete it. A bubble pointing at nothing is
	// worse than no bubble.
	const empty = { querySelector: () => null } as unknown as Document;
	assert.equal(anchorPoint(empty, "gone"), undefined);
	assert.equal(anchorPoint(undefined, "goal"), undefined, "no document yet, either");
});

test("the bubble flips to the left rather than hanging off the board", () => {
	assert.equal(bubbleSide({ x: 400 }, 1800), "right");
	assert.equal(bubbleSide({ x: 1700 }, 1800), "left", "240px of bubble would sit outside the board");
	assert.equal(bubbleSide({ x: 1559 }, 1800), "right", "…and exactly fits at the boundary");
});
