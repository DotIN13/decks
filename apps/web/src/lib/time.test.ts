import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { clockTime, dayKey, formatDate, setTimeZone, timeZone, yearOf, zoneShortName } from "./time.ts";

afterEach(() => setTimeZone(undefined));

// 1 January 2027, 03:30 UTC: still New Year's Eve in Los Angeles, already afternoon in Tokyo.
const at = Date.UTC(2027, 0, 1, 3, 30);

test("times are drawn in the deck's zone once one is set", () => {
	setTimeZone("America/Los_Angeles");
	assert.match(clockTime(at), /7:30/);
	setTimeZone("Asia/Tokyo");
	assert.match(clockTime(at), /12:30/);
});

test("the calendar day and the year are the zone's, not the browser's", () => {
	setTimeZone("America/Los_Angeles");
	assert.equal(dayKey(at), "2026-12-31");
	assert.equal(yearOf(at), 2026);
	assert.match(formatDate(at, { day: "numeric", month: "long" }), /31/);
	setTimeZone("Asia/Tokyo");
	assert.equal(dayKey(at), "2027-01-01");
	assert.equal(yearOf(at), 2027);
});

test("a zone Intl refuses is ignored, and unset means the browser's own", () => {
	setTimeZone("Mars/Olympus");
	assert.equal(timeZone(), undefined);
	assert.doesNotThrow(() => clockTime(at));
});

test("a zone's short name, for beside a schedule's hour", () => {
	assert.equal(zoneShortName("America/Los_Angeles", Date.UTC(2026, 6, 1)), "PDT");
	assert.equal(zoneShortName("America/Los_Angeles", Date.UTC(2026, 0, 1)), "PST");
	assert.equal(zoneShortName("Mars/Olympus"), "");
});
