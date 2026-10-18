import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeScene } from "./fake-scene.ts";
import { boxDistance, dropSlot, frameAt, frameUnder, nearDrops } from "./drop.ts";

const column = () => fakeScene([
	{ id: "col", type: "frame", layout: "vertical", padding: 12, box: { x: 0, y: 0, w: 200, h: 300 } },
	{ id: "a", parent: "col", box: { x: 12, y: 12, w: 176, h: 40 } },
	{ id: "b", parent: "col", box: { x: 12, y: 62, w: 176, h: 40 } },
	{ id: "c", parent: "col", box: { x: 12, y: 112, w: 176, h: 40 } },
	{ id: "free", type: "frame", layout: "none", box: { x: 400, y: 0, w: 200, h: 200 } },
]);

test("a frame with layout is found only when stacking frames count", () => {
	const scene = column();
	assert.equal(frameAt(scene, { x: 50, y: 50 }), undefined);
	assert.equal(frameAt(scene, { x: 50, y: 50 }, true), "col");
	assert.equal(frameAt(scene, { x: 450, y: 50 }), "free");
});

test("a drag never drops into what it carries", () => {
	const scene = column();
	assert.equal(frameUnder(scene, { x: 50, y: 50 }, ["col"]), null);
	assert.equal(frameUnder(scene, { x: 50, y: 50 }, ["a"]), "col");
	assert.equal(frameUnder(scene, { x: 900, y: 900 }, []), null);
});

test("the slot is the boundary nearest the pointer, and the line sits inside the padding", () => {
	const scene = column();
	const slot = dropSlot(scene, "col", { x: 50, y: 70 }, [])!;
	assert.equal(slot.index, 1);
	assert.deepEqual(slot.line, { x: 12, y: 57, w: 176, h: 0 });
	assert.equal(dropSlot(scene, "col", { x: 50, y: 290 }, [])!.index, 3);
	assert.equal(dropSlot(scene, "free", { x: 450, y: 50 }, []), undefined);
});

test("a carried child is skipped when asking which side, but still counted in the index", () => {
	const scene = column();
	// Carrying b: just under a's middle is before c, which is index 2 counting b.
	assert.equal(dropSlot(scene, "col", { x: 50, y: 70 }, ["b"])!.index, 2);
});

test("near the pointer, every slot whose line passes within reach shows, but not the one the drop takes", () => {
	const scene = column();
	// Carrying c, its place folds away: three slots are left (before a, between a and b, after b), and the drop takes the middle one.
	const near = nearDrops(scene, { x: 100, y: 57 }, ["c"], 60, { into: "col", line: { x: 12, y: 57, w: 176, h: 0 } });
	assert.deepEqual(near.slots, [
		{ x: 12, y: 7, w: 176, h: 0 },
		{ x: 12, y: 107, w: 176, h: 0 },
	]);
	// The frame with no layout is 300 away: out of reach; within 320 it shows, dashed, whole.
	assert.deepEqual(near.frames, []);
	assert.deepEqual(nearDrops(scene, { x: 100, y: 57 }, ["c"], 320).frames, [{ x: 400, y: 0, w: 200, h: 200 }]);
});

test("a carried frame offers no slots of its own, and the frame a drop goes into is not drawn dashed", () => {
	const scene = column();
	assert.deepEqual(nearDrops(scene, { x: 100, y: 57 }, ["col"], 1000).slots, []);
	assert.deepEqual(nearDrops(scene, { x: 450, y: 50 }, ["a"], 10, { into: "free" }).frames, []);
	assert.deepEqual(nearDrops(scene, { x: 450, y: 50 }, ["a"], 10).frames, [{ x: 400, y: 0, w: 200, h: 200 }]);
});

test("a point's distance from a box is 0 inside it and straight-line outside", () => {
	assert.equal(boxDistance({ x: 5, y: 5 }, { x: 0, y: 0, w: 10, h: 10 }), 0);
	assert.equal(boxDistance({ x: 13, y: 14 }, { x: 0, y: 0, w: 10, h: 10 }), 5);
});
