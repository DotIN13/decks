import assert from "node:assert/strict";
import { test } from "node:test";
import { actRects, blockRect, cursorFor, holding, landed } from "./acts.ts";

/** A board document with root blocks at known places, in the iframe's own terms. */
function doc(blocks: Record<string, { x: number; y: number; w: number; h: number }>) {
	return {
		querySelector: (selector: string) => {
			const id = /\[data-id="(.*)"\]/.exec(selector)?.[1] ?? "";
			const at = blocks[id];
			return at ? { offsetLeft: at.x, offsetTop: at.y, offsetWidth: at.w, offsetHeight: at.h } : null;
		},
	} as unknown as Document;
}

test("blockRect: the block's box in board coordinates, or nothing", () => {
	const d = doc({ doc: { x: 40, y: 30, w: 600, h: 200 }, ghost: { x: 0, y: 0, w: 0, h: 0 } });
	assert.deepEqual(blockRect(d, "doc"), { x: 40, y: 30, w: 600, h: 200 });
	assert.equal(blockRect(d, "missing"), undefined);
	assert.equal(blockRect(d, "ghost"), undefined, "a block with no size is not drawn");
	assert.equal(blockRect(undefined, "doc"), undefined);
});

test("actRects keeps the act's order and drops what the board cannot find", () => {
	const d = doc({ a: { x: 0, y: 0, w: 10, h: 10 }, b: { x: 20, y: 20, w: 10, h: 10 } });
	assert.deepEqual(actRects(d, { ids: ["b", "missing", "a"] }), [
		{ x: 20, y: 20, w: 10, h: 10 },
		{ x: 0, y: 0, w: 10, h: 10 },
	]);
	assert.deepEqual(actRects(d, {}), []);
});

test("cursorFor: inside the first block's corner, else where the verb happened", () => {
	const board = { w: 1000, h: 700 };
	assert.deepEqual(cursorFor({ what: "edit", phase: "start" }, [{ x: 40, y: 30, w: 600, h: 200 }], board), { x: 54, y: 42 });
	// A tiny block: the cursor stays inside it rather than 14px in.
	assert.deepEqual(cursorFor({ what: "edit", phase: "done" }, [{ x: 40, y: 30, w: 8, h: 8 }], board), { x: 44, y: 34 });
	assert.deepEqual(cursorFor({ what: "new", phase: "done" }, [], board), { x: 28, y: 28 });
	assert.deepEqual(cursorFor({ what: "resize", phase: "done" }, [], board), { x: 986, y: 686 });
	assert.deepEqual(cursorFor({ what: "show", phase: "done" }, [], board), { x: 500, y: 16 });
	assert.deepEqual(cursorFor({ what: "edit", phase: "start" }, [], board), { x: 500, y: 16 });
});

test("holding is a write in progress; landed is a write that named its blocks", () => {
	assert.equal(holding({ phase: "start", what: "edit" }), true);
	assert.equal(holding({ phase: "done", what: "edit" }), false);
	assert.equal(holding({ phase: "start", what: "show" }), false);
	assert.equal(landed({ phase: "done", what: "edit", ids: ["doc"] }), true);
	assert.equal(landed({ phase: "done", what: "edit" }), false);
	assert.equal(landed({ phase: "done", what: "resize", ids: ["doc"] }), false);
});
