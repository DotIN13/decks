import assert from "node:assert/strict";
import { test } from "node:test";
import { apply, arrowPoints, baseTheme, emptyDocument, layout, makeLabel, makeShape, reroute, shapeKind, shapeOutline, sidedRoute, type PenDocument } from "./index.ts";

const theme = baseTheme(emptyDocument(), "light");
const diamond = shapeKind("Decision")!;

test("a shape's outline takes its frame's size after any edit", () => {
	const { doc } = apply(emptyDocument(), [{ op: "insert", node: makeShape(diamond, { frame: "d", outline: "d-o" }, { w: 160, h: 120 }), box: { x1: 100, y1: 50 } }], { theme });
	const grown = apply(doc, [{ op: "update", id: "d", box: { x1: 100, y1: 50, x2: 300, y2: 210 } }], { theme }).doc;
	const frame = grown.children[0]!;
	const outline = shapeOutline(frame)!;
	assert.equal(frame.width, 200);
	assert.equal(frame.height, 160);
	assert.deepEqual([outline.x, outline.y, outline.width, outline.height], [0, 0, 200, 160]);
	// Laid out, the outline sits on the frame exactly, and the words centre in it.
	const withWords = apply(grown, [{ op: "insert", parent: "d", node: makeLabel("d-t", "Signed in?") }], { theme }).doc;
	const placed = layout(withWords, withWords.children, { theme });
	assert.deepEqual(placed.get("d-o")!.box, placed.get("d")!.box);
	const words = placed.get("d-t")!.box;
	const box = placed.get("d")!.box;
	assert.ok(Math.abs(words.y + words.h / 2 - (box.y + box.h / 2)) < 1, "the label is centred down the shape");
	assert.equal(words.w, box.w - 20, "the label is as wide as the shape less its padding");
});

test("an arrow end that names a side leaves the middle of that side", () => {
	const doc: PenDocument = {
		version: "2.6",
		children: [
			{ type: "rectangle", id: "a", x: 0, y: 0, width: 100, height: 60 },
			{ type: "rectangle", id: "b", x: 300, y: 200, width: 100, height: 60 },
			{ type: "path", id: "ab", metadata: { type: "decks.arrow", from: { item: "a", side: "bottom" }, to: { item: "b", side: "left" }, route: "elbow" } },
		],
	};
	const placed = layout(doc, doc.children, { theme });
	const points = arrowPoints(doc.children[2]!.metadata, placed)!;
	assert.deepEqual(points, [[50, 60], [50, 230], [300, 230]]);
	assert.equal(reroute(doc, placed), true);
	assert.equal(typeof doc.children[2]!.geometry, "string");
	// A plain string end still joins as it did.
	assert.deepEqual(arrowPoints({ type: "decks.arrow", from: "a", to: "b" }, placed)!.length, 2);
});

test("a sided route with one side open meets the side facing it", () => {
	const a = { x: 0, y: 0, w: 100, h: 100 };
	const b = { x: 300, y: 0, w: 100, h: 100 };
	assert.deepEqual(sidedRoute(a, b, "straight", "right", undefined), [[100, 50], [300, 50]]);
	assert.deepEqual(sidedRoute(a, b, "straight", "top", undefined)[0], [50, 0]);
});

test("a rounded shape is redrawn in its own pixels, so a wide one keeps round corners", () => {
	const rounded = shapeKind("Rounded")!;
	const made = makeShape(rounded, { frame: "r", outline: "r-o" }, { w: 160, h: 100 });
	// 14% of the shorter side, in pixels, not 14 units of a box that gets stretched.
	assert.equal(made.metadata?.radius, 14);
	const { doc } = apply(emptyDocument(), [{ op: "insert", node: made, box: { x1: 0, y1: 0 } }], { theme });
	const wide = apply(doc, [{ op: "update", id: "r", box: { x1: 0, y1: 0, x2: 600, y2: 100 } }], { theme }).doc;
	const outline = shapeOutline(wide.children[0]!)!;
	assert.deepEqual(outline.viewBox, [0, 0, 600, 100], "the outline is drawn in the shape's own pixels");
	// Every corner arc is the same radius both ways round: a circle, however wide the shape is pulled.
	assert.match(String(outline.geometry), /A14 14 /);
	assert.equal(String(outline.geometry).match(/A14 14 /g)?.length, 4);
	// Dragged rounder, up to half the shorter side.
	const square = apply(wide, [{ op: "update", id: "r", set: { metadata: { type: "decks.shape", kind: "Rounded", radius: 500 } } }], { theme }).doc;
	assert.match(String(shapeOutline(square.children[0]!)!.geometry), /A50 50 /, "the radius stops at half the shorter side");
});

test("the cylinder's cap winds with its body, so its top is filled", () => {
	const geometry = shapeKind("Database")!.geometry;
	const [body, cap] = geometry.split(/(?=M)/).filter(Boolean).map((part) => part.trim());
	// Both arcs sweep the same way: a nonzero fill cancelled them when they did not, leaving a hole.
	assert.match(String(body), /A50 14 0 0 1 100 14/);
	assert.match(String(cap), /^M100 14A50 14 0 0 1 0 14$/);
});
