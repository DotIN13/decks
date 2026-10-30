import assert from "node:assert/strict";
import { test } from "node:test";
import { apply, baseTheme, layout, resolve, withDecksColors, type PenDocument } from "@decks/pen";
import { inkHex, inkItem, strokeOf } from "./ink.ts";

test("a stroke becomes a pen path in its own box, and reads back as the same stroke where it is drawn", () => {
	const node = inkItem({ tool: "pen", color: "red", size: 4, points: [100, 200, 0.5, 140, 230, 0.15000000596] }, "s1");
	assert.equal(node.type, "path");
	assert.deepEqual([node.x, node.y, node.width, node.height], [96, 196, 48, 38]);
	assert.deepEqual(node.viewBox, [0, 0, 48, 38]);
	assert.deepEqual((node.metadata as unknown as { points: number[] }).points, [4, 4, 0.5, 44, 34, 0.15]);
	const doc: PenDocument = { version: "2.14", children: [{ ...node, x: 196 }] };
	const stroke = strokeOf(layout(doc, doc.children, { theme: {} }).get("s1")!)!;
	assert.deepEqual(stroke.points, [200, 200, 0.5, 240, 230, 0.15]);
	assert.equal(stroke.color, "red");
});

test("every ink colour is a Decks variable for light and dark, defined by the stroke's edit", () => {
	for (const color of ["ink", "red", "blue", "green", "yellow"] as const) {
		const node = inkItem({ tool: "pen", color, size: 2, points: [0, 0, 0.5, 20, 0, 0.5] }, "s");
		const paint = (node.stroke ?? node.fill) as string;
		assert.match(paint, /^\$decks-/, `${color} is a variable`);
		const ops = withDecksColors({ version: "2.14", children: [] }, [{ op: "insert", node }]);
		assert.equal(ops.length, 2, `${color}'s variable is defined with it`);
		const doc = apply({ version: "2.14", children: [] }, ops as Parameters<typeof apply>[1], { theme: {} }).doc;
		assert.equal(resolve(doc, paint, baseTheme(doc, "light")), inkHex(color, "light"));
		assert.equal(resolve(doc, paint, baseTheme(doc, "dark")), inkHex(color, "dark"));
		assert.notEqual(inkHex(color, "light"), inkHex(color, "dark"));
	}
});
