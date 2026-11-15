import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { exactWidth, LADDER, rungFor } from "./picture.ts";

// Rule 11: the picture route keeps exactly the canvas's ladder, read here from the canvas
// library's own list so the two cannot drift; a rung asked is answered at that width.

const DEVICE = new URL("../../packages/canvas/src/render/device.ts", import.meta.url);

test("rule 11: every rung any device's ladder asks is a rung the route keeps, and no other", () => {
	const text = readFileSync(DEVICE, "utf8");
	const block = text.slice(text.indexOf("export const PICTURES"));
	const rungs = [...block.slice(0, block.indexOf("};")).matchAll(/ladder:\s*\[([^\]]*)\]/g)].flatMap((m) => m[1]!.split(",").map(Number));
	assert.ok(rungs.length > 0, "the canvas library's PICTURES ladders were found");
	assert.deepEqual([...new Set(rungs)].sort((a, b) => a - b), [...LADDER]);
});

test("rule 11: a rung asked is that width; between rungs the next one up; never past the top", () => {
	for (const rung of LADDER) assert.equal(rungFor(rung), rung);
	assert.equal(rungFor(300), 480);
	assert.equal(rungFor(600), 800);
	assert.equal(rungFor(1500), 800);
});

test("rule 11: a screenshot or an export draws a card at the width it needs, at most 2000", () => {
	assert.equal(exactWidth(799.2), 800);
	assert.equal(exactWidth(1200), 1200);
	assert.equal(exactWidth(5000), 2000);
});
