import type { ScheduleWhen } from "@decks/protocol";

/**
 * When a schedule fires: the arithmetic, pure and testable.
 *
 * A schedule is `at` in the server's local time on the days in `days`
 * (`Date.getDay()`: 0 Sunday .. 6 Saturday). Three questions are worth asking about
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
	return when;
}

/** Local midnight of the day `ts` is in. */
function startOfDay(ts: number): number {
	const at = new Date(ts);
	return new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
}

/**
 * The local calendar day `days` after the day `ts` is in.
 *
 * `Date#setDate` rather than adding 24 hours: across a daylight-saving transition a
 * local day is 23 or 25 hours long, and adding a fixed number of milliseconds skips
 * or repeats a day.
 */
function addDays(ts: number, days: number): number {
	const at = new Date(startOfDay(ts));
	at.setDate(at.getDate() + days);
	return at.getTime();
}

/**
 * The first instant this schedule fires strictly after `after`, or `0` for never.
 *
 * Walks at most a week of days: a non-empty day set wraps within seven days, so the
 * search is bounded and cheap. `0` is also what an empty day set means — a schedule
 * paused by clearing its days never fires, and never is a number here.
 */
export function nextRun(when: ScheduleWhen, after: number): number {
	const minutes = atMinutes(when.at);
	if (Number.isNaN(minutes) || when.days.length === 0) return 0;
	const time = minutes * 60_000;
	for (let offset = 0; offset <= 7; offset++) {
		const day = addDays(after, offset);
		if (!when.days.includes(new Date(day).getDay())) continue;
		const candidate = day + time;
		if (candidate > after) return candidate;
	}
	return 0;
}

/** Instants of this schedule strictly between `from` and `to` — the runs a dead server skipped. */
export function missedBetween(when: ScheduleWhen, from: number, to: number): number {
	const minutes = atMinutes(when.at);
	if (Number.isNaN(minutes) || when.days.length === 0) return 0;
	const time = minutes * 60_000;
	let missed = 0;
	// From `from`'s own day to `to`'s day, inclusive: an instant on `from`'s own day
	// after `from` can be a missed run too, when the server came back after it.
	for (let day = addDays(from, 0); day <= startOfDay(to); day = addDays(day, 1)) {
		const candidate = day + time;
		if (candidate > from && candidate < to) missed += 1;
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
	let cursor = lastRunAt ?? 0;
	let missed = 0;
	let next = nextRun(when, cursor);
	const today = startOfDay(now);
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