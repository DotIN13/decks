import assert from "node:assert/strict";
import { test } from "node:test";
import { inkKey } from "./ink-keys.ts";

const press = (key: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) =>
	inkKey({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods });

test("the draw tool's keys: undo, redo, delete and escape, and nothing else", () => {
	assert.equal(press("z", { metaKey: true }), "undo");
	assert.equal(press("Z", { ctrlKey: true }), "undo");
	assert.equal(press("z", { metaKey: true, shiftKey: true }), "redo");
	assert.equal(press("y", { ctrlKey: true }), "redo");
	assert.equal(press("Backspace"), "delete");
	assert.equal(press("Delete"), "delete");
	assert.equal(press("Escape"), "escape");
	assert.equal(press("z"), undefined, "a bare letter is not the tool's");
	assert.equal(press("Backspace", { metaKey: true }), undefined);
	assert.equal(press("z", { metaKey: true, altKey: true }), undefined);
});
