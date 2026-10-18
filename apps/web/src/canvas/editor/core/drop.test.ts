import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeScene } from "./fake-scene.ts";
import { dropSlot, frameAt, frameUnder } from "./drop.ts";

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
