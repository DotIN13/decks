import assert from "node:assert/strict";
import { test } from "node:test";
import { linkChip, type PenNode } from "@decks/pen";
import { editsFor } from "./link-chips.ts";

/** A chip as a drawing holds it: ids on it and on its parts. */
const chip = (id: string, to: string, title: string, kind: "canvas" | "card" | "document" | "app" = "canvas"): PenNode => {
	const made = linkChip({ to, kind, title }) as unknown as PenNode;
	return { ...made, id, children: (made.children ?? []).map((child, at) => ({ ...child, id: `${id}-${at}` })) };
};
const words = (id: string, content: string): PenNode => ({ type: "text", id, content, metadata: { type: "decks.markdown" } });

test("a canvas called something else: the chips that showed its name show the new one, and one with words of its own keeps them", () => {
	const nodes = [chip("a", "#canvas/notes", "Research notes"), chip("b", "#canvas/notes", "The interviews"), chip("c", "#canvas/other", "Research notes"), { type: "frame", id: "f", children: [chip("d", "#canvas/notes", "Research notes")] } as PenNode];
	assert.deepEqual(editsFor(nodes, { did: "titled", canvas: "notes", was: "Research notes", title: "Field notes" }), [
		{ op: "update", id: "a-1", set: { content: "Field notes" } },
		{ op: "update", id: "a", set: { name: "Field notes" } },
		{ op: "update", id: "d-1", set: { content: "Field notes" } },
		{ op: "update", id: "d", set: { name: "Field notes" } },
	]);
});

test("a canvas moved to another folder: links to it and to what it keeps follow, in chips and in drawn words", () => {
	const nodes = [
		chip("a", "#canvas/untitled-canvas", "Plan"),
		chip("b", "#card/canvases/untitled-canvas/cards/q3/index.html", "Q3", "card"),
		chip("c", "#doc/canvases/untitled-canvas/files/the%20brief.md", "the brief.md", "document"),
		chip("d", "#canvas/untitled-canvas-2", "Another"),
		chip("e", "#app/untitled-canvas", "An app of the same name", "app"),
		words("w", "See [the plan](#canvas/untitled-canvas) and [Q3](#card/canvases/untitled-canvas/cards/q3/index.html), not [this](#canvas/untitled-canvas-2) or [that](https://example.com/#canvas/untitled-canvas)."),
	];
	assert.deepEqual(editsFor(nodes, { did: "moved", from: "untitled-canvas", to: "launch-plan" }), [
		{ op: "update", id: "a", set: { metadata: { type: "decks.link", to: "#canvas/launch-plan" } } },
		{ op: "update", id: "b", set: { metadata: { type: "decks.link", to: "#card/canvases/launch-plan/cards/q3/index.html" } } },
		{ op: "update", id: "c", set: { metadata: { type: "decks.link", to: "#doc/canvases/launch-plan/files/the%20brief.md" } } },
		{ op: "update", id: "w", set: { content: "See [the plan](#canvas/launch-plan) and [Q3](#card/canvases/launch-plan/cards/q3/index.html), not [this](#canvas/untitled-canvas-2) or [that](https://example.com/#canvas/untitled-canvas)." } },
	]);
});

test("a canvas deleted: the chips to it and to what it kept are dimmed, once", () => {
	const nodes = [chip("a", "#canvas/notes", "Notes"), chip("b", "#card/canvases/notes/cards/q3/index.html", "Q3", "card"), chip("c", "#canvas/other", "Other"), { ...chip("d", "#canvas/notes", "Notes"), opacity: 0.45 }];
	assert.deepEqual(editsFor(nodes, { did: "removed", canvas: "notes" }), [
		{ op: "update", id: "a", set: { opacity: 0.45 } },
		{ op: "update", id: "b", set: { opacity: 0.45 } },
	]);
});
