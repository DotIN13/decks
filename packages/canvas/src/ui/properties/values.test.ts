import assert from "node:assert/strict";
import { test } from "node:test";
import type { PenNode } from "@decks/pen";
import { MIXED, colorOf, fillModeOf, hexOf, kindOf, lineColorOf, lineWidthOf, shared } from "./values.ts";

const item = (fields: Record<string, unknown>) => ({ id: "a", type: "rectangle", ...fields }) as unknown as PenNode;

test("an item's kind is what the panel shows sections for: a note's family is one kind, an unknown type is other", () => {
	assert.equal(kindOf(item({ type: "text" })), "text");
	assert.equal(kindOf(item({ type: "prompt" })), "note");
	assert.equal(kindOf(item({ type: "icon_font" })), "icon");
	assert.equal(kindOf(item({ type: "ellipse" })), "ellipse");
	assert.equal(kindOf(item({ type: "browser" })), "other");
});

test("a colour is read as hex whatever it is written in, and a variable stays the name it is written as", () => {
	assert.equal(hexOf("#ff0000"), "#ff0000");
	assert.equal(hexOf([{ type: "color", color: "#00ff00" }]), "#00ff00");
	assert.equal(hexOf({ type: "gradient", colors: [] }), undefined);
	assert.equal(colorOf("$decks-text"), "$decks-text");
	assert.equal(colorOf({ type: "color", color: "$decks-fill-blue" }), "$decks-fill-blue");
	assert.equal(colorOf("#0000ff"), "#0000ff");
});

test("a fill is none, solid, linear or radial", () => {
	assert.equal(fillModeOf(item({})), "none");
	assert.equal(fillModeOf(item({ fill: [] })), "none");
	assert.equal(fillModeOf(item({ fill: "#ffffff" })), "solid");
	assert.equal(fillModeOf(item({ fill: { type: "gradient", gradientType: "radial", colors: [] } })), "radial");
	assert.equal(fillModeOf(item({ fill: { type: "gradient", colors: [] } })), "linear");
});

test("a line's width and colour are read from pen's fields, and from its older one-object stroke", () => {
	assert.equal(lineWidthOf(item({})), 0);
	assert.equal(lineWidthOf(item({ stroke: "#000000" })), 1);
	assert.equal(lineWidthOf(item({ stroke: "#000000", strokeWidth: 3 })), 3);
	assert.equal(lineWidthOf(item({ stroke: { thickness: 2, fill: "#112233" } })), 2);
	assert.equal(lineColorOf(item({ stroke: { thickness: 2, fill: "#112233" } })), "#112233");
	assert.equal(lineColorOf(item({ stroke: "$decks-line" })), "$decks-line");
});

test("several items share a value or read Mixed, and none read nothing", () => {
	const width = (node: PenNode) => node.width;
	assert.equal(shared([], width), undefined);
	assert.equal(shared([item({ width: 10 }), item({ width: 10 })], width), 10);
	assert.equal(shared([item({ width: 10 }), item({ width: 12 })], width), MIXED);
});
