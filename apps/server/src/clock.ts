/**
 * Calendar time in a named zone: the arithmetic, pure and testable.
 *
 * The server's machine is usually on UTC and the person is not. Two things follow the
 * person's zone: the process clock, which `settings.ts` sets from the deck's setting so
 * that an agent's shell and the runtime's own "today" agree with them, and everything in
 * this file, which takes the zone as an argument. A schedule may carry a zone of its own
 * ("every weekday at nine, London time"), so its arithmetic cannot lean on the process
 * clock, and a test of it should not depend on the machine it runs on.
 *
 * `Intl` is the only source of zone rules here. There is no table of offsets and no
 * library: the runtime already ships the tz database, and a second copy is a second
 * thing to keep current.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
	let made = formatters.get(zone);
	if (!made) {
		made = new Intl.DateTimeFormat("en-US", {
			timeZone: zone,
			hourCycle: "h23",
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			weekday: "short",
		});
		formatters.set(zone, made);
	}
	return made;
}

/** The zone the process is on now: the deck's setting once it is applied, else the machine's. */
export function processZone(): string {
	return new Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Whether `zone` is a name the runtime knows, such as "America/Los_Angeles". */
export function isZone(zone: unknown): zone is string {
	if (typeof zone !== "string" || !zone.trim()) return false;
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: zone });
		return true;
	} catch {
		return false;
	}
}

export interface ZonedParts {
	year: number;
	/** 1 to 12. */
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
	/** `Date.getDay()`'s numbering: 0 Sunday to 6 Saturday. */
	weekday: number;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** What the wall clock in `zone` reads at the instant `ts`. */
export function partsIn(ts: number, zone: string): ZonedParts {
	const out: Record<string, string> = {};
	for (const part of formatter(zone).formatToParts(new Date(ts))) out[part.type] = part.value;
	return {
		year: Number(out.year),
		month: Number(out.month),
		day: Number(out.day),
		hour: Number(out.hour),
		minute: Number(out.minute),
		second: Number(out.second),
		weekday: WEEKDAYS.indexOf(out.weekday ?? ""),
	};
}

/** How far `zone`'s wall clock is ahead of UTC at `ts`, in milliseconds. */
export function offsetAt(ts: number, zone: string): number {
	const at = partsIn(ts, zone);
	const asUtc = Date.UTC(at.year, at.month - 1, at.day, at.hour, at.minute, at.second);
	return asUtc - Math.floor(ts / 1000) * 1000;
}

/**
 * The instant at which `zone`'s wall clock reads the given date and minutes past midnight.
 *
 * Built from the calendar date and the clock time, never by adding minutes to midnight:
 * on the two days a year the clocks change, midnight plus eight hours is 07:00 or 09:00.
 * The offset is looked up twice because the first guess may fall on the other side of a
 * change, and the answer is whichever of the two the zone's clock really reads as that
 * time. A time the clocks skip (02:30 on a spring-forward night) is read by neither, and
 * lands after the gap.
 */
export function instantIn(zone: string, year: number, month: number, day: number, minutes: number): number {
	const wall = Date.UTC(year, month - 1, day, 0, minutes);
	const early = wall - offsetAt(wall, zone);
	const late = wall - offsetAt(early, zone);
	const reads = (ts: number) => {
		const at = partsIn(ts, zone);
		return at.day === day && at.hour * 60 + at.minute === minutes;
	};
	if (reads(late)) return late;
	if (reads(early)) return early;
	return Math.max(early, late);
}

/** The calendar date `days` after the one given, as a date: month ends and leap years handled. */
export function addCalendarDays(year: number, month: number, day: number, days: number): { year: number; month: number; day: number; weekday: number } {
	const at = new Date(Date.UTC(year, month - 1, day + days));
	return { year: at.getUTCFullYear(), month: at.getUTCMonth() + 1, day: at.getUTCDate(), weekday: at.getUTCDay() };
}

/** "UTC−7", "UTC+5:30", "UTC". */
export function offsetLabel(ts: number, zone: string): string {
	const minutes = Math.round(offsetAt(ts, zone) / 60_000);
	if (minutes === 0) return "UTC";
	const hours = Math.floor(Math.abs(minutes) / 60);
	const rest = Math.abs(minutes) % 60;
	return `UTC${minutes < 0 ? "−" : "+"}${hours}${rest ? `:${String(rest).padStart(2, "0")}` : ""}`;
}

const pad = (value: number, width = 2) => String(value).padStart(width, "0");

/** "2026-09-18T12:19:40-07:00": the instant, written with the zone's own offset. */
export function isoIn(ts: number, zone: string): string {
	const at = partsIn(ts, zone);
	const minutes = Math.round(offsetAt(ts, zone) / 60_000);
	const sign = minutes < 0 ? "-" : "+";
	const offset = `${sign}${pad(Math.floor(Math.abs(minutes) / 60))}:${pad(Math.abs(minutes) % 60)}`;
	return `${pad(at.year, 4)}-${pad(at.month)}-${pad(at.day)}T${pad(at.hour)}:${pad(at.minute)}:${pad(at.second)}${offset}`;
}

/** "Friday 18 September 2026, 12:19 (America/Los_Angeles, UTC−7)": a sentence an agent can read. */
export function nowWords(ts: number, zone: string): string {
	const date = new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(ts));
	const at = partsIn(ts, zone);
	return `${date.replace(",", "")}, ${pad(at.hour)}:${pad(at.minute)} (${zone}, ${offsetLabel(ts, zone)})`;
}
