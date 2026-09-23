import assert from "node:assert/strict";
import { test } from "node:test";
import { layout, type PenDocument } from "@decks/pen";
import { inkItem, inkVariableEdit, strokeOf } from "./ink.ts";

test("a stroke becomes a pen path in its own box, and reads back as the same stroke where it is drawn", () => {
	const node = inkItem({ tool: "pen", color: "red", size: 4, points: [100, 200, 0.5, 140, 230, 0.15000000596] }, "s1");
	assert.equal(node.type, "path");
	assert.deepEqual([node.x, node.y, node.width, node.height], [96, 196, 48, 38]);
	assert.deepEqual(node.viewBox, [0, 0, 48, 38]);
	assert.deepEqual((node.metadata as { points: number[] }).points, [4, 4, 0.5, 44, 34, 0.15]);
	const doc: PenDocument = { version: "2.14", children: [{ ...node, x: 196 }] };
	const stroke = strokeOf(layout(doc, doc.children, { theme: {} }).get("s1")!)!;
	assert.deepEqual(stroke.points, [200, 200, 0.5, 240, 230, 0.15]);
	assert.equal(stroke.color, "red");
});

test("the ink colour is a pen variable for light and dark, added once", () => {
	const edit = inkVariableEdit({ version: "2.14", children: [] }) as { themes: unknown; set: Record<string, { value: unknown[] }> };
	assert.deepEqual(edit.themes, { Mode: ["Light", "Dark"] });
	assert.equal(edit.set["decks-ink"]!.value.length, 2);
	assert.equal(inkVariableEdit({ version: "2.14", children: [], variables: { "decks-ink": { type: "color", value: "#000" } } }), undefined);
	const themed = inkVariableEdit({ version: "2.14", children: [], themes: { Look: ["dark", "light"] } }) as { themes?: unknown; set: Record<string, { value: Array<{ theme: unknown }> }> };
	assert.equal(themed.themes, undefined);
	assert.deepEqual(themed.set["decks-ink"]!.value[0]!.theme, { Look: "light" });
});
