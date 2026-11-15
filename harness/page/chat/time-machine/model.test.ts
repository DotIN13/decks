import assert from "node:assert/strict";
import { test } from "node:test";
import { actRows, endsPreview, previewTarget } from "./model.ts";

// The time machine's acts, and which end a preview first.

test("four acts, in order, with restore last", () => {
	assert.deepEqual(actRows(false).map((r) => r.act), ["preview", "rewind", "fork", "restore"]);
});

test("preview pressed again stops previewing", () => {
	assert.equal(actRows(true)[0]!.label, "Stop previewing");
	assert.equal(previewTarget(true, "e1"), null);
	assert.equal(previewTarget(false, "e1"), "e1");
});

test("rewind and fork end the preview first; restore does not", () => {
	assert.equal(endsPreview("rewind"), true);
	assert.equal(endsPreview("fork"), true);
	assert.equal(endsPreview("restore"), false);
});
