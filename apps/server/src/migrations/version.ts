import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Which shape a deck is kept in on disk: a semantic version, `major.minor.patch`, in
 * `.decks/migrations.json` beside what each migration recorded when it ran.
 *
 * Each at-open migration carries the version a deck is at once it has run (`MIGRATIONS` in
 * `migrations/index.ts`), and a deck's version is that of the last one run on it. The deck format is
 * not settled, so it stays below 1.0.0, where semantic versioning moves the minor for a breaking change:
 *
 * - **minor** (0.3.0 → 0.4.0): an older Decks would misread the deck: folders moved, an item kind
 *   renamed or added, a file format changed.
 * - **patch** (0.4.0 → 0.4.1): an older Decks still reads it correctly: leftovers removed, data fixed
 *   in place, something added that older builds ignore.
 * - **major** goes to 1 only when the format is declared stable; from then on it is the breaking part.
 *
 * A deck at the latest is opened after reading this one small file: no migration looks at its folders.
 * A deck made by this build starts at the latest, since there is nothing old in it to move. A deck from
 * before versions has one worked out from what its file already recorded (`derivedVersion`), written
 * back, and is then treated like any other. A deck with a newer breaking change than this build knows
 * was written by a newer Decks, which this one may misread, and is left alone with a line in the log;
 * a newer patch is read as it is.
 */
export type Semver = string;

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

/** `[major, minor, patch]`, or undefined for anything that is not exactly `x.y.z`. */
export function parseSemver(version: unknown): [number, number, number] | undefined {
	const match = typeof version === "string" ? SEMVER.exec(version) : null;
	return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

/** Negative when `a` is older than `b`, positive when newer, 0 when the same. */
export function compareSemver(a: Semver, b: Semver): number {
	const x = parseSemver(a) ?? [0, 0, 0];
	const y = parseSemver(b) ?? [0, 0, 0];
	return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

/**
 * The part of a version a breaking change moves: the major from 1.0.0 on, the minor below it, so
 * 0.4.3 and 0.4.0 share `0.4.0`, and 1.2.0 and 1.7.1 share `1.0.0`.
 */
export function breakingPart(version: Semver): Semver {
	const [major, minor] = parseSemver(version) ?? [0, 0, 0];
	return major > 0 ? `${major}.0.0` : `0.${minor}.0`;
}

/** The version of a deck no migration has run on. */
export const NONE: Semver = "0.0.0";

export const RECORD_FILE = join(".decks", "migrations.json");

export type MigrationRecord = { version?: unknown; [migration: string]: unknown };

export function readRecord(deck: string): MigrationRecord {
	try {
		const parsed = JSON.parse(readFileSync(join(deck, RECORD_FILE), "utf8")) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as MigrationRecord) : {};
	} catch {
		return {};
	}
}

/** Set the deck's version, keeping everything the migrations recorded. */
export function writeVersion(deck: string, version: Semver): void {
	const file = join(deck, RECORD_FILE);
	const record = readRecord(deck);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, `${JSON.stringify({ ...record, version }, null, "\t")}\n`);
}

/**
 * The version of a deck whose file has none yet: that of the last migration in an unbroken run from
 * the first that is done. One counts as done when it recorded itself, or when it has nothing to record
 * and its old shape is gone (`done`). A gap stops the count, so a migration skipped by an older build runs.
 */
export function derivedVersion(record: MigrationRecord, migrations: readonly { version: Semver; id: string; done?: (deck: string) => boolean }[], deck: string): Semver {
	let version = NONE;
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
