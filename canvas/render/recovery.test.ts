import assert from "node:assert/strict";
import { test } from "node:test";
import { Recovery } from "./recovery.ts";

test("an engine error restarts the stage, up to three times a minute, then stops it", () => {
	let now = 0;
	const recovery = new Recovery(3, 60_000, () => now);
	assert.deepEqual([recovery.note(), recovery.note(), recovery.note()], ["restart", "restart", "restart"]);
	now = 30_000;
	assert.equal(recovery.note(), "stop", "a fault that keeps coming back does not loop");
	now = 61_000;
	assert.equal(recovery.note(), "restart", "a minute later it is a new fault, and is restarted again");
});
