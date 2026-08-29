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
	ids: ["note", "goal"],
	generated: false,
	...over,
});

test("a component's family decides which rows it gets", () => {
	assert.equal(familyOf("div", ["sticky"], {}), "box");
	assert.equal(familyOf("section", ["card"], {}), "box");
	assert.equal(familyOf("svg", ["link"], { "data-from": "a" }), "link");
	assert.equal(familyOf("div", ["embed"], { "data-embed": "../a.pdf" }), "embed");
	// An embed the agent wrote without the class is still an embed: board.js goes by
	// the attribute, and so does this.
	assert.equal(familyOf("div", [], { "data-embed": "../a.pdf" }), "embed");
	// A kpi has a vocabulary of its own that this build does not know; it keeps its
	// name, its order and its copy, and gets no appearance rows.
	assert.equal(familyOf("div", ["kpi"], {}), "other");
});

test("swapping the box keeps classes this build does not own", () => {
	assert.equal(swapBox(["card"], "panel"), "panel");
	assert.equal(swapBox(["card", "wide"], "callout"), "callout wide");
	assert.equal(swapBox(["wide"], "card"), "card wide");
	// Idempotent, so clicking the class it already has writes the same attribute.
	assert.equal(swapBox(["panel"], "panel"), "panel");
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
