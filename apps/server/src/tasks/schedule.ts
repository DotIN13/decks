import type { ScheduleWhen } from "@decks/protocol";
import { addCalendarDays, instantIn, isZone, partsIn, processZone } from "../clock.ts";

/**
 * When a schedule fires: the arithmetic, pure and testable.
 *
 * A schedule is `at` on the days in `days` (`Date.getDay()`: 0 Sunday .. 6 Saturday), read
 * in a timezone: the schedule's own `timezone` when it has one ("every weekday at nine,
 * London time"), else the process clock, which is the deck's Time setting once one is
 * chosen (`settings.ts`). The zone is an argument to every calculation here (`clock.ts`),
 * so a run is built from a calendar date and a clock time in that zone and is right on the
 * days the clocks change. Three questions are worth asking about
 * such a schedule, and all three are answerable without a clock:
 *
 * - `nextRun` — the first instant after a given one;
 * - `tick` — is a run due now, and were any missed while the server was down;
 * - `atMinutes` / `validateWhen` — is what the panel handed in a schedule at all.
 *
 * **The missed-run policy is `tick`, and it is the most deliberate decision on this
 * board.** A run whose instant is *before today* is skipped, not replayed, and
 * counted. A digest for yesterday is not the digest you want this morning, and a
 * scheduler that fires a burst of missed runs at boot is exactly the surprise that
 * makes cron fearsome. A run whose instant is *today* and already past fires
 * immediately — the server was down at 09:00 and comes back at 09:05, so the digest
 * it makes is today's, a few minutes late, which is the case worth saving.
 */

/** "HH:MM" → minutes since midnight, or `NaN` from anything else. */
export function atMinutes(at: string): number {
	const match = /^(\d{1,2}):(\d{2})$/.exec(at.trim());
	if (!match) return NaN;
	const hours = Number(match[1]);
	const minutes = Number(match[2]);
	if (hours > 23 || minutes > 59) return NaN;
	return hours * 60 + minutes;
}

/** The smallest useful check: the fields are a real schedule, or throw with a sentence. */
export function validateWhen(when: ScheduleWhen): ScheduleWhen {
	const minutes = atMinutes(when.at);
	if (Number.isNaN(minutes)) throw new Error(`"${when.at}" is not a time. Use HH:MM, like "09:00".`);
	const valid = (value: number) => Number.isInteger(value) && value >= 0 && value <= 6;
	if (!when.days.every(valid)) throw new Error("A schedule's days are 0 (Sunday) to 6 (Saturday), and one of the entries is not.");
	if (when.timezone !== undefined && !isZone(when.timezone)) throw new Error(`"${when.timezone}" is not a timezone. Use an IANA name, like "America/Los_Angeles".`);
	return when;
}

/** The zone a schedule is read in: its own, else the process clock's. */
export function zoneOf(when: ScheduleWhen): string {
	return when.timezone && isZone(when.timezone) ? when.timezone : processZone();
}

/** Midnight, in `zone`, of the calendar day `ts` falls on there. */
function startOfDay(ts: number, zone: string): number {
	const at = partsIn(ts, zone);
	return instantIn(zone, at.year, at.month, at.day, 0);
}

/** The first instant after `after` at which the schedule fires, or `0` when it never does. */
export function nextRun(when: ScheduleWhen, after: number): number {
	const minutes = atMinutes(when.at);
	if (Number.isNaN(minutes) || when.days.length === 0) return 0;
	const zone = zoneOf(when);
	const from = partsIn(after, zone);
	for (let offset = 0; offset <= 7; offset++) {
		const day = addCalendarDays(from.year, from.month, from.day, offset);
		if (!when.days.includes(day.weekday)) continue;
		const candidate = instantIn(zone, day.year, day.month, day.day, minutes);
		if (candidate > after) return candidate;
	}
	return 0;
}

/** How many runs fall strictly between two instants. */
export function missedBetween(when: ScheduleWhen, from: number, to: number): number {
	const minutes = atMinutes(when.at);
	if (Number.isNaN(minutes) || when.days.length === 0) return 0;
	const zone = zoneOf(when);
	const first = partsIn(from, zone);
	let missed = 0;
	// From `from`'s own day to `to`'s day, inclusive: an instant on `from`'s own day
	// after `from` can be a missed run too, when the server came back after it.
	for (let offset = 0; ; offset++) {
		const day = addCalendarDays(first.year, first.month, first.day, offset);
		const candidate = instantIn(zone, day.year, day.month, day.day, minutes);
		if (instantIn(zone, day.year, day.month, day.day, 0) > to) break;
		if (when.days.includes(day.weekday) && candidate > from && candidate < to) missed += 1;
	}
	return missed;
}

/** What one look at the clock says about one schedule. */
export interface TickOutcome {
	/** The instant of the run to fire now, `0` when none is due. */
	due: number;
	/** The next instant to remember — what `nextRunAt` should be after this tick. */
	next: number;
	/** Runs older than today, skipped rather than replayed. */
	missed: number;
}

/**
 * Decide what a schedule is owed at `now`, from its `lastRunAt` cursor.
 *
 * `lastRunAt` is a cursor as much as a record: after a missed run is skipped, the
 * cursor is advanced *past* it, so the same run is not decided twice. That is what
 * `missed` counts as it goes.
 */
export function tick(when: ScheduleWhen, lastRunAt: number | undefined, now: number): TickOutcome {
	const today = startOfDay(now, zoneOf(when));
	/*
	 * A schedule that has never run has missed nothing. Its cursor starts at the end of
	 * yesterday, not at zero: from zero this walked every day since 1970, which cost
	 * seconds a tick and reported twenty thousand skipped runs on a job made that morning.
	 */
	let cursor = lastRunAt ?? today - 1;
	let missed = 0;
	let next = nextRun(when, cursor);
	// Runs strictly before today are too old to want. Skip and count until the cursor
	// walks into today (or tomorrow, when nothing of today is left).
	while (next > 0 && next < today) {
		missed += 1;
		cursor = next;
		next = nextRun(when, cursor);
	}
	if (next > 0 && next <= now) return { due: next, next: nextRun(when, next), missed };
	return { due: 0, next, missed };
}