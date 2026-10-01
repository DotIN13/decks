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

test("one agent's readings are kept per canvas and per device, and it is told the newest of its own canvas", () => {
	const cameras = new Cameras();
	const laptop = { x: 10, y: 10, zoom: 1 };
	const phone = { x: 500, y: 20, zoom: 0.4 };
	const elsewhere = { x: -9000, y: 0, zoom: 0.2 };
	cameras.report("a", laptop, { stage: "main", device: "laptop" });
	cameras.report("a", phone, { stage: "main", device: "phone" });
	cameras.report("a", elsewhere, { stage: "sketches", device: "laptop" });
	assert.deepEqual(cameras.answer("a", "main"), phone, "the newest reading of the canvas it is on");
	assert.deepEqual(cameras.answer("a", "sketches"), elsewhere);
	cameras.report("a", laptop, { stage: "main", device: "laptop" });
	assert.deepEqual(cameras.answer("a", "main"), laptop, "the laptop's newer reading replaces its own, not the phone's");
	assert.deepEqual(cameras.answer("a", "never"), { x: 0, y: 0, zoom: 1 }, "a canvas nobody looked at is the origin");
});
