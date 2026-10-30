import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeScene } from "../edit/core/fake-scene.ts";
import { easeOut, GLIDE_MS, glideAt, glideShifts, landingBoxes } from "./glide.ts";

/** A column holding a b c, and a loose item x, inside an outer frame that holds the column and a note. */
const scene = () =>
	fakeScene([
		{ id: "outer", type: "frame", layout: "vertical", box: { x: 0, y: 0, w: 400, h: 600 } },
		{ id: "col", type: "frame", layout: "vertical", parent: "outer", box: { x: 10, y: 10, w: 200, h: 170 } },
		{ id: "a", parent: "col", box: { x: 20, y: 20, w: 180, h: 40 } },
		{ id: "b", parent: "col", box: { x: 20, y: 70, w: 180, h: 40 } },
		{ id: "c", parent: "col", box: { x: 20, y: 120, w: 180, h: 40 } },
		{ id: "note", parent: "outer", box: { x: 10, y: 200, w: 200, h: 80 } },
		{ id: "x", box: { x: 600, y: 600, w: 100, h: 50 } },
	]);

test("what a drop can move is where it was let go: the carried item moved by the drag, the rest of every frame it touches as now", () => {
	const boxes = landingBoxes(scene(), ["x"], { dx: -540, dy: -515 }, "col");
	assert.deepEqual(boxes.get("x"), { x: 60, y: 85, w: 100, h: 50 });
	// The column's children, and the frame it sits in: the column itself and the note.
	assert.deepEqual([...boxes.keys()].sort(), ["a", "b", "c", "col", "note", "x"]);
	assert.deepEqual(boxes.get("b"), { x: 20, y: 70, w: 180, h: 40 });
	// Leaving the column: its siblings close the gap.
	assert.deepEqual([...landingBoxes(scene(), ["b"], { dx: 600, dy: 0 }, null).keys()].sort(), ["a", "b", "c", "col", "note"]);
	// A drag at the top level touches nothing but itself.
	assert.deepEqual([...landingBoxes(scene(), ["x"], { dx: 5, dy: 5 }, null).keys()], ["x"]);
});

test("only what moved glides, by how far it moved, and an item inside one that glides goes with it", () => {
	const before = new Map([
		["x", { x: 60, y: 85, w: 100, h: 50 }],
		["b", { x: 20, y: 70, w: 180, h: 40 }],
		["a", { x: 20, y: 20, w: 180, h: 40 }],
		["col", { x: 10, y: 10, w: 200, h: 170 }],
	]);
	const after = new Map([
		["x", { x: 20, y: 70, w: 180, h: 40 }],
		["b", { x: 20, y: 120, w: 180, h: 40 }],
		["a", { x: 20, y: 20.3, w: 180, h: 40 }],
		["col", { x: 10, y: 10, w: 200, h: 220 }],
	]);
	const parents: Record<string, string> = { x: "col", b: "col", a: "col" };
	const shifts = glideShifts(before, (id) => after.get(id), (id) => parents[id]);
	assert.deepEqual([...shifts], [
		["x", { dx: 40, dy: 15 }],
		["b", { dx: 0, dy: -50 }],
	]);
	// A frame that moves carries its children: they do not glide on their own as well.
	const moved = glideShifts(before, (id) => (id === "col" ? { x: 50, y: 10, w: 200, h: 170 } : { ...before.get(id)!, x: before.get(id)!.x + 40 }), (id) => parents[id]);
	assert.deepEqual([...moved.keys()], ["col"]);
});

test("a glide eases out over 150 ms: all of the shift at the start, a little at the end, none after", () => {
	assert.equal(GLIDE_MS, 150);
	const shifts = new Map([["x", { dx: 100, dy: -40 }]]);
	assert.deepEqual(glideAt(shifts, 0).get("x"), { dx: 100, dy: -40 });
	// Halfway through the time, seven eighths of the way there.
	const half = glideAt(shifts, 75).get("x")!;
	assert.equal(Math.round(half.dx * 1000) / 1000, 12.5);
	assert.equal(Math.round(half.dy * 1000) / 1000, -5);
	assert.deepEqual(glideAt(shifts, 150).get("x"), { dx: 0, dy: -0 });
	assert.equal(easeOut(2), 1);
});
