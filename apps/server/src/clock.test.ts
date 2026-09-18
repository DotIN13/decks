import assert from "node:assert/strict";
import { test } from "node:test";
import { addCalendarDays, instantIn, isoIn, isZone, nowWords, offsetAt, offsetLabel, partsIn } from "./clock.ts";

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

test("08:00 is 08:00 on the days the clocks change", () => {
	// 8 March 2026: Los Angeles springs forward at 02:00. Midnight is UTC−8, 08:00 is UTC−7.
	assert.equal(instantIn(LA, 2026, 3, 8, 8 * 60), Date.UTC(2026, 2, 8, 15, 0));
	// 1 November 2026: it falls back. Midnight is UTC−7, 08:00 is UTC−8.
	assert.equal(instantIn(LA, 2026, 11, 1, 8 * 60), Date.UTC(2026, 10, 1, 16, 0));
	// An ordinary day.
	assert.equal(instantIn(LA, 2026, 9, 18, 8 * 60), Date.UTC(2026, 8, 18, 15, 0));
	// A time the clocks skip lands after the gap, not before it.
	assert.equal(partsIn(instantIn(LA, 2026, 3, 8, 2 * 60 + 30), LA).hour, 3);
});

test("calendar days roll over months and years, with the weekday", () => {
	assert.deepEqual(addCalendarDays(2026, 12, 31, 1), { year: 2027, month: 1, day: 1, weekday: 5 });
	assert.deepEqual(addCalendarDays(2028, 2, 28, 1), { year: 2028, month: 2, day: 29, weekday: 2 });
});
