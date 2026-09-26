import assert from "node:assert/strict";
import { test } from "node:test";
import { Cameras } from "./cameras.ts";

/* What an agent is told its stage is looking at: its own reading, never another agent's. */

const mine = { x: 100, y: 200, zoom: 1, width: 1440, height: 900 };
const theirs = { x: -18_000, y: 950_000, zoom: 1, width: 1378, height: 702 };

test("an agent is told its own view, whoever reported last", () => {
	const cameras = new Cameras();
	cameras.report("a", mine);
	cameras.report("b", theirs);
	assert.deepEqual(cameras.answer("a"), mine);
});

test("an agent nobody has looked at is told the origin, sized like the last screen, not another's place", () => {
	const cameras = new Cameras();
	cameras.report("b", theirs);
	assert.deepEqual(cameras.answer("a"), { x: 0, y: 0, zoom: 1, width: 1378, height: 702 });
});

test("a reading that says no agent is dropped", () => {
	const cameras = new Cameras();
	cameras.report(undefined, theirs);
	assert.deepEqual(cameras.answer("a"), { x: 0, y: 0, zoom: 1 }, "not even as a size");
});
