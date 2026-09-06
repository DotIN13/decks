import assert from "node:assert/strict";
import { test } from "node:test";
import { contentExtent } from "./extent.ts";

const box = (right: number, bottom: number) => ({ right, bottom, width: 10, height: 10 });

test("the extent is the far corner of everything on the board", () => {
	assert.deepEqual(contentExtent([box(400, 200), box(120, 900), box(360, 80)]), { w: 400, h: 900 });
});

test("an empty board has no extent, rather than an extent of nothing", () => {
	assert.equal(contentExtent([]), undefined);
	assert.equal(contentExtent([{ right: 0, bottom: 0, width: 0, height: 0 }]), undefined, "a hidden component is not content");
});

test("a fraction of a pixel counts as a pixel, because the alternative clips", () => {
	assert.deepEqual(contentExtent([box(400.2, 199.6)]), { w: 401, h: 200 });
});
