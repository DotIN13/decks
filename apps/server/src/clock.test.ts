import assert from "node:assert/strict";
import { test } from "node:test";
import { isoIn, isZone, nowWords, offsetAt, offsetLabel, partsIn } from "./clock.ts";

const LA = "America/Los_Angeles";

test("a zone is a name the runtime knows", () => {
	assert.equal(isZone(LA), true);
	assert.equal(isZone("UTC"), true);
	assert.equal(isZone("Mars/Olympus"), false);
	assert.equal(isZone(""), false);
	assert.equal(isZone(7), false);
});

test("the wall clock in a zone, and its offset, at a known instant", () => {
	const ts = Date.UTC(2026, 8, 18, 19, 19, 40); // 18 September 2026, 19:19:40 UTC
	assert.deepEqual(partsIn(ts, LA), { year: 2026, month: 9, day: 18, hour: 12, minute: 19, second: 40, weekday: 5 });
	assert.equal(offsetAt(ts, LA), -7 * 3600_000);
	assert.equal(offsetLabel(ts, LA), "UTC−7");
	assert.equal(offsetLabel(ts, "Asia/Kolkata"), "UTC+5:30");
	assert.equal(offsetLabel(ts, "UTC"), "UTC");
	assert.equal(isoIn(ts, LA), "2026-09-18T12:19:40-07:00");
	assert.equal(nowWords(ts, LA), "Friday 18 September 2026, 12:19 (America/Los_Angeles, UTC−7)");
});

