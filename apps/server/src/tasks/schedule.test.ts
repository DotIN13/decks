import { test } from "node:test";
import assert from "node:assert/strict";
import { atMinutes, missedBetween, nextRun, tick, validateWhen } from "./schedule.ts";
import type { ScheduleWhen } from "@decks/protocol";

const when: ScheduleWhen = { at: "09:00", days: [1, 2, 3, 4, 5] }; // weekdays

/** An instant at HH:MM:00 on a weekday — the fixtures here use real Mondays. */
function at(day: string, time: string): number {
	const [hours, minutes] = time.split(":").map(Number);
	return new Date(`${day}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`).getTime();
}

test("atMinutes accepts a time and refuses anything else", () => {
	assert.equal(atMinutes("09:00"), 540);
	assert.equal(atMinutes("0:00"), 0);
	assert.equal(atMinutes("23:59"), 23 * 60 + 59);
	assert.ok(Number.isNaN(atMinutes("9")));
	assert.ok(Number.isNaN(atMinutes("09:60")));
	assert.ok(Number.isNaN(atMinutes("24:00")));
});

test("validateWhen throws with a sentence on a bad time or day", () => {
	assert.throws(() => validateWhen({ at: "nine", days: [1] }), /HH:MM/);
	assert.throws(() => validateWhen({ at: "09:00", days: [7] }), /0 \(Sunday\) to 6/);
	assert.equal(validateWhen(when), when);
});

test("nextRun is the first scheduled instant after a given one, same day", () => {
	assert.equal(nextRun(when, at("2026-06-08", "08:00")), at("2026-06-08", "09:00"));
});

test("nextRun skips to the next scheduled day when today's is past", () => {
	// Monday 09:00 asked for at 10:00 — the next weekday is Tuesday.
	assert.equal(nextRun(when, at("2026-06-08", "10:00")), at("2026-06-09", "09:00"));
});

test("nextRun walks a weekend: Friday at 10:00 → Monday", () => {
	// 2026-06-12 is a Friday.
	assert.equal(nextRun(when, at("2026-06-12", "10:00")), at("2026-06-15", "09:00"));
});

test("nextRun never fires from an empty day set, and returns 0", () => {
	assert.equal(nextRun({ at: "09:00", days: [] }, 0), 0);
});

test("missedBetween counts the instants a dead server skipped", () => {
	// Ran Monday 09:00, came back Wednesday 08:59: only Tuesday's run was owed and skipped.
	assert.equal(missedBetween(when, at("2026-06-08", "09:00"), at("2026-06-10", "08:59")), 1);
	// Down across one instant only: one.
	assert.equal(missedBetween(when, at("2026-06-08", "08:00"), at("2026-06-08", "10:00")), 1);
	assert.equal(missedBetween(when, at("2026-06-08", "09:00"), at("2026-06-08", "10:00")), 0);
});

test("tick runs an instant on the same day, even when late", () => {
	const outcome = tick(when, at("2026-06-08", "08:00"), at("2026-06-08", "09:05"));
	assert.equal(outcome.due, at("2026-06-08", "09:00"));
	assert.equal(outcome.missed, 0);
});

test("tick skips and counts an instant from a previous day — never replays it", () => {
	// Server was down across yesterday's 09:00 and boots this morning: yesterday is
	// skipped and counted, today's is due.
	const outcome = tick(when, at("2026-06-08", "08:00"), at("2026-06-09", "10:00"));
	assert.equal(outcome.missed, 1);
	assert.equal(outcome.due, at("2026-06-09", "09:00"));
});

test("tick does not stack a whole weekend: Friday's is skipped, Monday's is due", () => {
	// Down since Thursday, booted Monday 11:00: Friday is counted and skipped, Monday's is due.
	const outcome = tick(when, at("2026-06-11", "10:00"), at("2026-06-15", "11:00"));
	assert.equal(outcome.missed, 1); // just Friday — the weekend is not a run
	assert.equal(outcome.due, at("2026-06-15", "09:00"));
});

test("tick advances the cursor past a skipped run so it is not decided twice", () => {
	const first = tick(when, at("2026-06-08", "08:00"), at("2026-06-09", "10:00"));
	assert.equal(first.missed, 1);
	// The caller persists `lastRunAt = due`; the next tick from there sees nothing new.
	const second = tick(when, first.due, at("2026-06-09", "10:05"));
	assert.equal(second.due, 0);
	assert.equal(second.missed, 0);
});

test("tick with nothing scheduled produces nothing due", () => {
	const outcome = tick({ at: "09:00", days: [] }, undefined, Date.now());
	assert.equal(outcome.due, 0);
	assert.equal(outcome.missed, 0);
});
// --- a schedule in a named zone: independent of the machine's own clock ---------------

const LA = "America/Los_Angeles";

test("a schedule with a timezone fires at that zone's hour, whatever the server is on", () => {
	const job: ScheduleWhen = { at: "08:00", days: [0, 1, 2, 3, 4, 5, 6], timezone: LA };
	// Friday 18 September 2026, 12:00 UTC is 05:00 in Los Angeles: today's 08:00 is 15:00 UTC.
	assert.equal(nextRun(job, Date.UTC(2026, 8, 18, 12, 0)), Date.UTC(2026, 8, 18, 15, 0));
	// At 16:00 UTC it has passed: the next is tomorrow's.
	assert.equal(nextRun(job, Date.UTC(2026, 8, 18, 16, 0)), Date.UTC(2026, 8, 19, 15, 0));
});

test("the weekday is the zone's weekday, not the server's", () => {
	// Mondays at 23:00 in Los Angeles is Tuesday 06:00 UTC.
	const job: ScheduleWhen = { at: "23:00", days: [1], timezone: LA };
	const next = nextRun(job, Date.UTC(2026, 8, 20, 0, 0)); // Saturday evening in Los Angeles
	assert.equal(next, Date.UTC(2026, 8, 22, 6, 0));
});

test("08:00 stays 08:00 across both clock changes", () => {
	const job: ScheduleWhen = { at: "08:00", days: [0, 1, 2, 3, 4, 5, 6], timezone: LA };
	// Spring forward, Sunday 8 March 2026: Saturday's run is 16:00 UTC, Sunday's is 15:00 UTC.
	const saturday = nextRun(job, Date.UTC(2026, 2, 7, 12, 0));
	assert.equal(saturday, Date.UTC(2026, 2, 7, 16, 0));
	assert.equal(nextRun(job, saturday), Date.UTC(2026, 2, 8, 15, 0));
	// Fall back, Sunday 1 November 2026: Saturday's is 15:00 UTC, Sunday's is 16:00 UTC.
	const october = nextRun(job, Date.UTC(2026, 9, 31, 12, 0));
	assert.equal(october, Date.UTC(2026, 9, 31, 15, 0));
	assert.equal(nextRun(job, october), Date.UTC(2026, 10, 1, 16, 0));
});

test("'before today' in the missed-run rule is the zone's today", () => {
	const job: ScheduleWhen = { at: "08:00", days: [0, 1, 2, 3, 4, 5, 6], timezone: LA };
	// Last ran two Los Angeles mornings ago; looked at 11:00 in Los Angeles today.
	const now = Date.UTC(2026, 8, 18, 18, 0);
	const outcome = tick(job, Date.UTC(2026, 8, 16, 15, 0), now);
	assert.equal(outcome.missed, 1);
	assert.equal(outcome.due, Date.UTC(2026, 8, 18, 15, 0));
	assert.equal(outcome.next, Date.UTC(2026, 8, 19, 15, 0));
});

test("a timezone that is not one is refused with a sentence", () => {
	assert.throws(() => validateWhen({ at: "09:00", days: [1], timezone: "Pacific" }), /not a timezone/);
	assert.doesNotThrow(() => validateWhen({ at: "09:00", days: [1], timezone: "Europe/London" }));
});
