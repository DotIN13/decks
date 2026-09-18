import assert from "node:assert/strict";
import { test } from "node:test";
import {
	cleanStrokes,
	decodePoints,
	encodePoints,
	hitStroke,
	inkBounds,
	inkCommit,
	inkHistory,
	inkLayerMarkup,
	inkRedo,
	inkUndo,
	lassoPick,
	moveStroke,
	simplify,
	strokeAttributes,
	strokeFromAttributes,
	strokeShape,
	type InkStroke,
} from "./ink.ts";

const stroke = (id: string, points: number[], extra: Partial<InkStroke> = {}): InkStroke => ({ id, tool: "pen", color: "red", size: 4, points, ...extra });

test("what came off the socket is checked field by field, and rounded once", () => {
	assert.deepEqual(cleanStrokes("nope"), []);
	const kept = cleanStrokes([
		stroke("ok", [1.234, 2.345, 0.5678]),
		{ ...stroke("colour", [1, 2, 0.5]), color: "#ff00ff" },
		{ ...stroke("tool", [1, 2, 0.5]), tool: "spray" },
		{ ...stroke("size", [1, 2, 0.5]), size: Number.NaN },
		stroke("pairs", [1, 2, 3, 4]),
		{ ...stroke("text", [1, 2, 0.5]), points: [1, "2", 3] },
		stroke('"><script>', [1, 2, 0.5]),
		null,
	]);
	assert.deepEqual(kept, [stroke("ok", [1.2, 2.3, 0.57])]);
});

test("points survive the attribute they are kept in", () => {
	const points = [10, 20.5, 0.5, 30.1, 40, 0.75];
	assert.equal(encodePoints(points), "10,20.5,0.5 30.1,40,0.75");
	assert.deepEqual(decodePoints(encodePoints(points)), points);
	assert.deepEqual(decodePoints("5,6"), [5, 6, 0.5], "a pair with no pressure is a mouse's");
});

test("a stroke written as a path is read back as the same stroke", () => {
	const drawn = stroke("s1", [10, 10, 0.2, 40, 30, 0.6, 80, 20, 0.9]);
	const attributes = new Map(strokeAttributes(drawn));
	assert.deepEqual(strokeFromAttributes((name) => attributes.get(name) ?? null), drawn);
	assert.equal(strokeFromAttributes(() => null), undefined);
});

test("a pen that pressed is an outline to fill; a mouse and a marker are a line to stroke", () => {
	const pressed = strokeShape(stroke("a", [0, 0, 0.2, 50, 0, 0.9, 100, 0, 0.4]));
	assert.equal(pressed.filled, true);
	assert.match(pressed.d, /^M.*A.*A.*Z$/, "two sides and a round cap at each end");
	const mouse = strokeShape(stroke("b", [0, 0, 0.5, 50, 10, 0.5, 100, 0, 0.5]));
	assert.deepEqual(mouse, { d: "M0 0Q50 10 75 5L100 0", filled: false });
	const marker = strokeShape(stroke("c", [0, 0, 0.1, 50, 0, 0.9], { tool: "marker" }));
	assert.equal(marker.filled, false);
	assert.equal(strokeShape(stroke("dot", [5, 5, 0.5])).d, "M5 5l0.01 0", "a dot is drawn by its round caps");
});

test("the layer is one svg the board can draw with no app around it, and nothing when empty", () => {
	assert.equal(inkLayerMarkup([]), "");
	const markup = inkLayerMarkup([stroke("s1", [0, 0, 0.5, 10, 10, 0.5]), stroke("s2", [5, 5, 0.5], { tool: "marker", color: "yellow" })], "\t");
	assert.match(markup, /^<svg class="ink" data-ink-layer xmlns=/);
	assert.match(markup, /pointer-events: none/);
	assert.match(markup, /\n\t\t<path data-ink="s1" data-tool="pen" data-color="red" data-size="4" fill="none" stroke="#e5484d"/);
	assert.match(markup, /data-ink="s2".*opacity="0\.4"/);
	assert.ok(markup.endsWith("\n\t</svg>"));
});

test("simplifying keeps the ends and the corners, and drops what sits on the line", () => {
	const line: number[] = [];
	for (let x = 0; x <= 100; x++) line.push(x, 0, 0.5);
	assert.deepEqual(simplify(line), [0, 0, 0.5, 100, 0, 0.5]);
	const corner = [0, 0, 0.5, 50, 0.1, 0.5, 100, 0, 0.5, 100, 50, 0.5, 100, 100, 0.5];
	assert.deepEqual(simplify(corner), [0, 0, 0.5, 100, 0, 0.5, 100, 100, 0.5]);
	const pressed = [0, 0, 0.2, 50, 0, 0.9, 100, 0, 0.2];
	assert.deepEqual(simplify(pressed), pressed, "a point where the pressure turns is a corner of the width");
});

test("the eraser touches a stroke along its whole length, and not beside it", () => {
	const drawn = stroke("a", [0, 0, 0.5, 100, 0, 0.5]);
	assert.equal(hitStroke(drawn, 50, 3, 2), true);
	assert.equal(hitStroke(drawn, 50, 20, 2), false);
	assert.equal(hitStroke(stroke("dot", [5, 5, 0.5]), 6, 6, 2), true);
});

test("a lasso takes the strokes it goes round, and not the neighbour it brushes", () => {
	const inside = stroke("in", [20, 20, 0.5, 40, 40, 0.5, 60, 20, 0.5]);
	const brushing = stroke("brush", [90, 50, 0.5, 150, 50, 0.5, 200, 50, 0.5, 250, 50, 0.5]);
	const loop = [0, 0, 100, 0, 100, 100, 0, 100];
	assert.deepEqual(lassoPick([inside, brushing], loop), ["in"]);
	assert.deepEqual(lassoPick([inside], [0, 0, 1, 1]), [], "two points are not a loop");
});

test("bounds include the width, and a move carries every point and no pressure", () => {
	const drawn = stroke("a", [10, 10, 0.5, 30, 20, 1]);
	const box = inkBounds([drawn]);
	assert.ok(box && box.x < 10 && box.y < 10 && box.x + box.w > 30);
	assert.equal(inkBounds([]), undefined);
	assert.deepEqual(moveStroke(drawn, 5, -5).points, [15, 5, 0.5, 35, 15, 1]);
});

test("undo and redo walk the lists the drawing has been, and a new stroke ends the redo", () => {
	const a = stroke("a", [0, 0, 0.5]);
	const b = stroke("b", [1, 1, 0.5]);
	let history = inkHistory([]);
	history = inkCommit(history, [a]);
	history = inkCommit(history, [a, b]);
	history = inkUndo(history);
	assert.deepEqual(history.present, [a]);
	history = inkRedo(history);
	assert.deepEqual(history.present, [a, b]);
	history = inkUndo(inkUndo(history));
	assert.deepEqual(history.present, []);
	assert.equal(inkUndo(history), history, "nothing before the first list");
	history = inkCommit(history, [b]);
	assert.equal(inkRedo(history), history, "drawing again is a new future");
});
