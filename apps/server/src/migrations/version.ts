import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Which shape a deck is kept in on disk: a number, in `.decks/migrations.json` beside what each
 * migration recorded when it ran.
 *
 * Each at-open migration has a version (`MIGRATIONS` in `migrations/index.ts`), and a deck's version is
 * the last one that has run on it. A deck at the latest is opened after reading this one small file: no
 * migration looks at its folders. A deck made by this build starts at the latest, since there is nothing
 * old in it to move. A deck from before versions had a number has one worked out from what its file
 * already recorded (`derivedVersion`), written back, and is then treated like any other.
 */
export const RECORD_FILE = join(".decks", "migrations.json");

export type MigrationRecord = { version?: number; [migration: string]: unknown };

export function readRecord(deck: string): MigrationRecord {
	try {
		const parsed = JSON.parse(readFileSync(join(deck, RECORD_FILE), "utf8")) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as MigrationRecord) : {};
	} catch {
		return {};
	}
}

/** Set the deck's version, keeping everything the migrations recorded. */
export function writeVersion(deck: string, version: number): void {
	const file = join(deck, RECORD_FILE);
	const record = readRecord(deck);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, `${JSON.stringify({ ...record, version }, null, "\t")}\n`);
}

/**
 * The version of a deck whose file has no number yet: the last migration in an unbroken run from the
 * first that is done. One counts as done when it recorded itself, or when it has nothing to record and
 * its old shape is gone (`done`). A gap stops the count, so a migration skipped by an older build runs.
 */
export function derivedVersion(record: MigrationRecord, migrations: readonly { version: number; id: string; done?: (deck: string) => boolean }[], deck: string): number {
	let version = 0;
	for (const one of migrations) {
		const recorded = one.id in record;
		if (!recorded && !one.done?.(deck)) break;
		version = one.version;
	}
	return version;
}

/** Whether a folder holds a deck already, in any shape this build or an older one kept it in. */
export function holdsADeck(deck: string): boolean {
	return ["deck.json", "boards", "stages", "canvases", ".decks"].some((name) => existsSync(join(deck, name)));
}
