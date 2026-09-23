import assert from "node:assert/strict";
import { test } from "node:test";
import { familyOf, isPdf, patchesFor, swapBox, type Shape } from "./inspect.ts";

const shape = (over: Partial<Shape> = {}): Shape => ({
	path: "boards/plan.html",
	id: "note",
	tag: "div",
	family: "box",
	box: "sticky",
	classes: ["sticky"],
	attrs: {},
	generated: false,
	...over,
});

test("a component's family decides which rows it gets", () => {
	assert.equal(familyOf(["sticky"], {}), "box");
	assert.equal(familyOf(["card"], {}), "box");
	assert.equal(familyOf(["embed"], { "data-embed": "../a.pdf" }), "embed");
	// An embed the agent wrote without the class is still an embed: board.js goes by
	// the attribute, and so does this.
	assert.equal(familyOf([], { "data-embed": "../a.pdf" }), "embed");
	// A kpi has a vocabulary of its own that this build does not know; it keeps its
	// name, its order and its copy, and gets no appearance rows.
	assert.equal(familyOf(["kpi"], {}), "other");
	// What the board-authoring skill promises an agent that invents a component: a box
	// class beside its own buys the appearance rows, and its absence is what costs them.
	assert.equal(familyOf(["card", "phases"], {}), "box");
	assert.equal(familyOf(["phases"], {}), "other");
	/*
	 * `class="link"` and the `<svg>` tag each used to be a family all by themselves — the
	 * connector's. There is no `link` family left, so a board still carrying one gets what
	 * any unrecognised component gets: a name, an order, a copy, a delete, and none of the
	 * appearance rows this build would have invented for it. The tag is not even asked for
	 * any more, which is what lets a hand-drawn diagram be a `card`.
	 */
	assert.equal(familyOf(["link"], { "data-from": "a", "data-to": "b" }), "other");
	assert.equal(familyOf(["card", "diagram"], {}), "box");
});

test("swapping the box keeps classes this build does not own", () => {
	assert.equal(swapBox(["card"], "callout"), "callout");
	assert.equal(swapBox(["card", "wide"], "callout"), "callout wide");
	assert.equal(swapBox(["wide"], "card"), "card wide");
	// Idempotent, so clicking the class it already has writes the same attribute.
	assert.equal(swapBox(["callout"], "callout"), "callout");
});

test("an emptied field clears the attribute rather than setting it to nothing", () => {
	// `data-pages=""` is a claim about the PDF, and board.js reads it as one.
	assert.deepEqual(patchesFor(shape(), { kind: "attr", name: "data-pages", value: "" }), [
		{ op: "update", id: "note", attrs: { "data-pages": null } },
	]);
	assert.deepEqual(patchesFor(shape(), { kind: "attr", name: "data-pages", value: "3-5" }), [
		{ op: "update", id: "note", attrs: { "data-pages": "3-5" } },
	]);
});

test("every inspector edit is one declarative patch", () => {
	assert.deepEqual(patchesFor(shape(), { kind: "box", to: "callout" }), [{ op: "update", id: "note", class: "callout" }]);
	assert.deepEqual(patchesFor(shape(), { kind: "rename", to: "risk" }), [{ op: "rename", id: "note", to: "risk" }]);
	assert.deepEqual(patchesFor(shape(), { kind: "order", to: "front" }), [{ op: "order", id: "note", to: "front" }]);
	assert.deepEqual(patchesFor(shape(), { kind: "duplicate" }), [{ op: "duplicate", id: "note" }]);
	assert.deepEqual(patchesFor(shape(), { kind: "remove" }), [{ op: "remove", id: "note" }]);
});

test("the page-range field belongs to PDFs, whatever the query string says", () => {
	assert.equal(isPdf("../papers/oauth.pdf"), true);
	assert.equal(isPdf("/api/file?path=x.pdf"), true);
	assert.equal(isPdf("../assets/photo.png"), false);
	assert.equal(isPdf(undefined), false);
});
