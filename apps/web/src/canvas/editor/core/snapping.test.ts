import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeScene } from "./fake-scene.ts";
import { selectionBox, snapTargets } from "./snapping.ts";

const view = { x: 0, y: 0, w: 1000, h: 1000 };

test("snap targets are the other top-level items and boards in view, never what moves", () => {
	const scene = fakeScene([
		{ id: "a", box: { x: 0, y: 0, w: 10, h: 10 } },
		{ id: "b", box: { x: 50, y: 0, w: 10, h: 10 } },
		{ id: "far", box: { x: 5000, y: 0, w: 10, h: 10 } },
	], [{ path: "boards/x.html", x: 100, y: 100, w: 200, h: 100 }]);
	assert.deepEqual(snapTargets(scene, ["a"], [], view), [{ x: 50, y: 0, w: 10, h: 10 }, { x: 100, y: 100, w: 200, h: 100 }]);
	assert.equal(snapTargets(scene, ["a"], ["boards/x.html"], view).length, 1);
});

test("inside a frame, only siblings count; arrows and an instance's inside never do", () => {
	const scene = fakeScene([
		{ id: "f", type: "frame", box: { x: 0, y: 0, w: 300, h: 300 } },
		{ id: "k1", parent: "f", box: { x: 10, y: 10, w: 10, h: 10 } },
		{ id: "k2", parent: "f", box: { x: 40, y: 10, w: 10, h: 10 } },
		{ id: "other", box: { x: 400, y: 0, w: 10, h: 10 } },
		{ id: "line", type: "path", box: { x: 0, y: 500, w: 100, h: 1 }, extra: { metadata: { type: "arrow" } } },
		{ id: "ref/inner", box: { x: 0, y: 600, w: 10, h: 10 } },
	]);
	const got = snapTargets(scene, ["k1"], [], view);
	assert.ok(got.some((box) => box.x === 40), "the sibling");
	assert.ok(got.some((box) => box.x === 400), "a top-level item");
	assert.ok(!got.some((box) => box.y === 600), "not an instance's inside");
});

test("a selection's box takes items as drawn and boards as placed", () => {
	const scene = fakeScene([{ id: "t", box: { x: 0, y: 0, w: 10, h: 10 }, drawn: { x: 0, y: 0, w: 40, h: 12 } }], [{ path: "b", x: 100, y: 50, w: 20, h: 20 }]);
	assert.deepEqual(selectionBox(scene, ["t"], ["b"]), { x: 0, y: 0, w: 120, h: 70 });
	assert.equal(selectionBox(scene, [], []), undefined);
});
