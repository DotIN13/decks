import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Shapes a deck was kept in before version 0.1.0, read where they are met, and only in a deck old
 * enough to hold them.
 *
 * Most changes of shape are moved once, when the deck opens, by a migration chosen by the deck's
 * version (`migrations/index.ts`). Three older ones were never moves: the running code reads the old
 * shape when it meets it and writes the new one back. They are the places an old `deck.json` laid its
 * boards out in (`oldBoardPlaces`, below), an agent's record that names a shared canvas, and an
 * agent's record that lists its own boards (`agents/old-records.ts`).
 *
 * Those readers used to run in every deck on every start. Now they run by the deck's version too: a
 * deck opened from below 0.1.0 is marked in `.decks/migrations.json` (`"old-shapes": { opened }`),
 * the readers work while the mark is open, and it is closed when that run of the server stops
 * cleanly, by which time every record has been restored and written back. A deck at 0.1.0 or later
 * with no open mark never runs them. A folder with no record at all (a deck no Decks with versions
 * has opened) counts as open, so nothing old is missed.
 */

const RECORD_FILE = join(".decks", "migrations.json");
const MARK = "old-shapes";

type Record_ = { [key: string]: unknown };

function read(deck: string): Record_ | undefined {
	try {
		const parsed = JSON.parse(readFileSync(join(deck, RECORD_FILE), "utf8")) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record_) : {};
	} catch {
		return existsSync(join(deck, RECORD_FILE)) ? {} : undefined;
	}
}

function write(deck: string, record: Record_): void {
	const file = join(deck, RECORD_FILE);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, `${JSON.stringify(record, null, "\t")}\n`);
}

/** Whether this deck may still hold shapes from before 0.1.0: the readers of them run only then. */
export function readsOldShapes(deck: string): boolean {
	const record = read(deck);
	if (record === undefined) return true;
	const mark = record[MARK] as { closed?: unknown } | undefined;
	return !!mark && !mark.closed;
}

/** The deck was opened from below 0.1.0: its old shapes are read until the mark is closed. */
export function openOldShapes(deck: string, now: Date = new Date()): void {
	const record = read(deck) ?? {};
	const mark = record[MARK] as { opened?: unknown; closed?: unknown } | undefined;
	if (mark && !mark.closed) return;
	write(deck, { ...record, [MARK]: { opened: now.toISOString() } });
}

/** A run that read the old shapes has stopped cleanly: every record was restored and written back. */
export function closeOldShapes(deck: string, now: Date = new Date()): void {
	const record = read(deck);
	const mark = record?.[MARK] as { opened?: unknown; closed?: unknown } | undefined;
	if (!record || !mark || mark.closed) return;
	write(deck, { ...record, [MARK]: { ...mark, closed: now.toISOString() } });
}

/**
 * 2026-09-16: where a board sits belongs to a canvas, not to `deck.json`.
 *
 * Older files kept a `boards` map of `{ x, y, w, h }`. Its `x`/`y` are read once more, as the places
 * a canvas starts from (`deck/loader.ts` hands them to the first canvas that draws the board), and
 * the map is dropped on the next write of `deck.json` (`deck/schema.ts`). A size is the board's own
 * file's business now, so `w`/`h` are ignored.
 */
export function oldBoardPlaces(boards: unknown, normalize: (path: string) => string, warnings: string[]): Record<string, { x: number; y: number }> {
	const places: Record<string, { x: number; y: number }> = {};
	if (!boards || typeof boards !== "object" || Array.isArray(boards)) return places;
	for (const [path, value] of Object.entries(boards as Record<string, unknown>)) {
		const at = value as { x?: unknown; y?: unknown } | null;
		const x = Number(at?.x);
		const y = Number(at?.y);
		if (Number.isFinite(x) && Number.isFinite(y)) places[normalize(path)] = { x: Math.round(x), y: Math.round(y) };
		else warnings.push(`deck.json: ignoring the position of "${path}". x and y must be numbers.`);
	}
	return places;
}
