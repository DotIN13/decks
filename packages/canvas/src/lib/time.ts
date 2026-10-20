/**
 * Every time and date the app draws goes through here, in the deck's timezone.
 *
 * The browser formats a time in its own zone, which is the person's on their laptop and is
 * not on a borrowed machine, a phone abroad, or a server they are screen-sharing from. The
 * deck has one timezone (Settings, Time), the one its schedules fire in and its agents are
 * told, and the app agrees with them: a turn stamped 08:00 means 08:00 where the deck's
 * schedules and agents say it is.
 *
 * Until a zone is chosen, `undefined` is passed to `Intl`, which means the browser's own:
 * exactly what every call site did before this file existed.
 *
 * The zone is a plain module variable rather than a signal on purpose. These functions are
 * called from pure helpers that are unit-tested without Solid, and the places that draw a
 * time re-run when the settings frame lands because they read `state.settings` themselves
 * (`deckZone()` in `state/deck.ts`).
 */

let zone: string | undefined;

/**
 * Called on every read of the zone. `state/deck.ts` hands in a function that reads a signal,
 * so a time drawn inside a reactive scope is drawn again when the zone changes, and this
 * file still imports nothing from Solid.
 */
let track: () => void = () => {};
export function trackZoneWith(read: () => void): void {
	track = read;
}

/** Set from the `settings` frame. A name `Intl` refuses is ignored rather than thrown on later. */
export function setTimeZone(next: string | undefined): void {
	if (next === undefined) {
		zone = undefined;
		return;
	}
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: next });
		zone = next;
	} catch {
		zone = undefined;
	}
}

export function timeZone(): string | undefined {
	track();
	return zone;
}

/** The browser's own zone: what Settings offers on first run. */
export function browserZone(): string {
	return new Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const withZone = (options: Intl.DateTimeFormatOptions, inZone = zone): Intl.DateTimeFormatOptions => {
	track();
	return inZone ? { ...options, timeZone: inZone } : options;
};

/** "2:05 PM", or "14:05" where the locale says so. */
export function clockTime(at: number | Date, inZone?: string): string {
	return new Date(at).toLocaleTimeString(undefined, withZone({ hour: "numeric", minute: "2-digit" }, inZone ?? zone));
}

export function formatDate(at: number | Date, options: Intl.DateTimeFormatOptions = {}): string {
	return new Date(at).toLocaleDateString(undefined, withZone(options));
}

export function formatDateTime(at: number | Date, options: Intl.DateTimeFormatOptions): string {
	return new Date(at).toLocaleString(undefined, withZone(options));
}

/** A key that is equal for two instants on the same calendar day in the deck's zone. */
export function dayKey(at: number | Date): string {
	return new Intl.DateTimeFormat("en-CA", withZone({ year: "numeric", month: "2-digit", day: "2-digit" })).format(new Date(at));
}

export function yearOf(at: number | Date): number {
	return Number(new Intl.DateTimeFormat("en-US", withZone({ year: "numeric" })).format(new Date(at)));
}
