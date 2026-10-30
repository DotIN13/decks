import { migrateStages } from "./2026-10-16-stages-to-canvases.ts";
import { describe, migrated, migrateStandalone } from "./2026-10-20-standalone-canvases.ts";
import { migrated as isolationMigrated, migrateIsolation } from "./2026-10-21-isolation-removed.ts";
import { migrated as markdownCardsMigrated, migrateMarkdownCards } from "./2026-10-28-markdown-cards.ts";
import { migrated as documentsAndAppsMigrated, migrateDocumentsAndApps } from "./2026-10-29-documents-and-apps.ts";
import { migrated as boardsToCardsMigrated, migrateBoardsToCards } from "./2026-10-29-boards-to-cards.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { breakingPart, compareSemver, derivedVersion, holdsADeck, NONE, parseSemver, readRecord, writeVersion, type Semver } from "./version.ts";

/**
 * Every change to how a deck is kept on disk, oldest first, and when each one runs.
 *
 * A migration lives here, one file per change, named by the day it shipped; the code that reads the
 * new shape lives where it always did and calls in. Two kinds:
 *
 * - **at open**: run by `runAtOpen` before the deck, its canvases or its agents are read, and only when
 *   the old shape is on disk, so running one again does nothing.
 * - **on read**: called from the reader of one record, as that record is read, and written back in the
 *   new shape so it is not read the old way again.
 *
 * | file                                       | runs    | called from                     |
 * | ------------------------------------------ | ------- | ------------------------------- |
 * | 2026-09-16-deck-json-places.ts             | on read | `deck/schema.ts`                |
 * | 2026-09-22-shared-canvases-to-agents.ts    | on read | `agents/registry.ts`            |
 * | 2026-10-16-board-lists-into-canvas-files.ts| on read | `agents/session.ts` (adoptStage) |
 * | 2026-10-16-stages-to-canvases.ts           | at open | `runAtOpen`, below              |
 * | 2026-10-20-standalone-canvases.ts          | at open | `runAtOpen`, below; once, after a backup, and recorded in `.decks/migrations.json` |
 * | 2026-10-21-isolation-removed.ts            | at open | `runAtOpen`, below; once, after a backup of what it changes, and recorded there too |
 * | 2026-10-28-markdown-cards.ts               | at open | `runAtOpen`, below; the same way |
 * | 2026-10-29-documents-and-apps.ts           | at open | `runAtOpen`, below; the same way |
 * | 2026-10-29-boards-to-cards.ts              | at open | `runAtOpen`, below; the same way, after documents and apps |
 *
 * Each at-open migration carries a semantic version, the deck's once it has run, and the deck keeps
 * the last one run on it in `.decks/migrations.json` (`version.ts`, which says which part a change moves). A deck at `LATEST` opens without any migration looking at it; one behind runs only
 * the migrations after its version, oldest first, and moves its version on after each, so a start cut
 * short goes on from where it stopped. A new deck starts at `LATEST`. A new migration goes at the end
 * of `MIGRATIONS`, with a version above the last.
 *
 * `DECKS_MIGRATE_DRY_RUN=1` on a harness's start (or `npm run migrate -- --dry-run <deck>`) prints
 * what the migrations still to run would move, and stops before anything is written.
 */
export class DryRun extends Error {
	constructor(readonly lines: string[]) {
		super("a dry run of the migrations: nothing was changed");
		this.name = "DryRun";
	}
}

type Options = { dataDir?: string; dryRun?: boolean };

export interface Migration {
	/** The deck's version once it has run: above the one before it, and never changed once shipped. */
	version: Semver;
	/** The file's name, and its key in `.decks/migrations.json` where it records itself. */
	id: string;
	/** Done already without a record, for one that writes none: its old shape is not on disk. */
	done?: (deck: string) => boolean;
	/** Run it; what it says goes to the log. */
	run: (deck: string, options: Options, say: (line: string) => void) => void;
	/** Every move it would make, made by none. */
	dryRun: (deck: string, log: (line: string) => void) => void;
	/** Whether it has recorded itself in the deck (`migrated`), for the ones that do. */
	migrated?: (deck: string) => boolean;
}

/** Every at-open migration, oldest first. */
export const MIGRATIONS: readonly Migration[] = [
	{
		// Breaking: canvases moved from stages/ to canvases/.
		version: "0.1.0",
		id: "2026-10-16-stages-to-canvases",
		done: (deck) => !existsSync(join(deck, "stages")) || existsSync(join(deck, "canvases")),
		run: (deck, _options, say) => {
			const moved = migrateStages(deck);
			if (moved.size) say(`moved ${moved.size} canvases from stages/ to canvases/`);
		},
		dryRun: (deck, log) => {
			if (existsSync(join(deck, "stages")) && !existsSync(join(deck, "canvases"))) log("would move stages/ to canvases/");
		},
	},
	{
		// Breaking: each canvas holds its own boards, frames and files.
		version: "0.2.0",
		id: "2026-10-20-standalone-canvases",
		migrated,
		run: (deck, options, say) => {
			const { plan, ran, backup } = migrateStandalone(deck, { ...(options.dataDir ? { dataDir: options.dataDir } : {}), log: say });
			if (ran && plan.canvases) [describe(plan).at(-1)!, ...(backup ? [`the deck as it was is in ${backup}`] : [])].forEach(say);
		},
		dryRun: (deck, log) => void migrateStandalone(deck, { dryRun: true, log }),
	},
	{
		// Not breaking: only isolated mode's leftovers go; an older build reads the canvases as before.
		version: "0.2.1",
		id: "2026-10-21-isolation-removed",
		migrated: isolationMigrated,
		run: (deck, _options, say) => {
			const { plan, ran, backup } = migrateIsolation(deck, { log: say });
			if (ran && (plan.marks.length || plan.agents.length)) [`isolated mode is gone: ${plan.agents.length} agent(s) and the canvases they used are ordinary now`, ...(backup ? [`what changed is backed up in ${backup}`] : [])].forEach(say);
		},
		dryRun: (deck, log) => void migrateIsolation(deck, { dryRun: true, log }),
	},
	{
		// Breaking: markdown cards get a new item type an older build does not draw.
		version: "0.3.0",
		id: "2026-10-28-markdown-cards",
		migrated: markdownCardsMigrated,
		run: (deck, _options, say) => {
			const { plan, ran, backup } = migrateMarkdownCards(deck, { log: say });
			const frames = plan.files.reduce((sum, file) => sum + file.frames, 0);
			if (ran && frames) [`markdown cards are decks.markdown-card now: ${frames} in ${plan.files.length} drawing(s)`, ...(backup ? [`the drawings as they were are in ${backup}`] : [])].forEach(say);
		},
		dryRun: (deck, log) => void migrateMarkdownCards(deck, { dryRun: true, log }),
	},
	{
		// Breaking: document and app boards become item kinds an older build does not know.
		version: "0.4.0",
		id: "2026-10-29-documents-and-apps",
		migrated: documentsAndAppsMigrated,
		run: (deck, _options, say) => {
			const { plan, ran, backup } = migrateDocumentsAndApps(deck, { log: say });
			const items = plan.files.reduce((sum, file) => sum + file.items.length, 0);
			if (ran && items) [`document and app boards are items now: ${items} in ${plan.files.length} canvas(es)`, ...(backup ? [`the drawings as they were are in ${backup}`] : [])].forEach(say);
		},
		dryRun: (deck, log) => void migrateDocumentsAndApps(deck, { dryRun: true, log }),
	},
	{
		// Breaking: boards become cards and the board files go.
		version: "0.5.0",
		id: "2026-10-29-boards-to-cards",
		migrated: boardsToCardsMigrated,
		run: (deck, _options, say) => {
			const { plan, ran, backup } = migrateBoardsToCards(deck, { log: say });
			const cards = plan.canvases.reduce((sum, one) => sum + one.cards.length, 0);
			if (ran && cards) [`boards are cards now: ${cards} in ${plan.canvases.filter((one) => one.cards.length).length} canvas(es)`, ...(backup ? [`the boards and drawings as they were are in ${backup}`] : [])].forEach(say);
		},
		dryRun: (deck, log) => void migrateBoardsToCards(deck, { dryRun: true, log }),
	},
];

/** The version a deck is at once every migration has run, and the one a new deck starts at. */
export const LATEST: Semver = MIGRATIONS.at(-1)!.version;

/**
 * The version the record says, if it says one: a semantic version as written, or a plain number from
 * the build that counted migrations 1, 2, 3 (the version of that many migrations in).
 */
function recordedVersion(value: unknown): Semver | undefined {
	if (parseSemver(value)) return value as Semver;
	if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value === 0 ? NONE : (MIGRATIONS[Math.min(value, MIGRATIONS.length) - 1]!.version);
	return undefined;
}

/** The deck's version: as its record says, or for a deck from before versions, the one its record implies. */
export function deckVersion(deck: string): Semver {
	const record = readRecord(deck);
	return recordedVersion(record.version) ?? derivedVersion(record, MIGRATIONS, deck);
}

/**
 * The at-open migrations still to run on this deck, in order. Returns a line for the log per migration
 * that changed anything. `dataDir` is the install's data folder, where its Allow decisions are kept;
 * `dryRun` throws a `DryRun` with every move, having written nothing.
 */
export function runAtOpen(deck: string, options: Options = {}): string[] {
	const dryRun = options.dryRun ?? process.env.DECKS_MIGRATE_DRY_RUN === "1";
	// Nothing here yet: the deck about to be made is in this build's shape, so it starts at the latest.
	if (!holdsADeck(deck)) {
		if (dryRun) throw new DryRun([`${deck} is new: it starts at version ${LATEST}, with nothing to migrate.`]);
		writeVersion(deck, LATEST);
		return [];
	}
	const record = readRecord(deck);
	const written = recordedVersion(record.version);
	const from = written ?? derivedVersion(record, MIGRATIONS, deck);
	const pending = MIGRATIONS.filter((one) => compareSemver(one.version, from) > 0);
	if (dryRun) {
		const lines: string[] = [];
		for (const one of pending) if (!one.migrated?.(deck)) one.dryRun(deck, (line) => lines.push(line));
		if (!pending.length) lines.push(`${deck} is migrated already (version ${from}): nothing to do.`);
		else lines.push(`${deck} is at version ${from}; ${pending.length} migration(s) would run, to version ${LATEST}.`);
		throw new DryRun(lines);
	}
	const said: string[] = [];
	// A newer breaking change was made by a newer Decks, which this build may misread; anything else it reads as it is.
	if (compareSemver(breakingPart(from), breakingPart(LATEST)) > 0) said.push(`this deck is at version ${from}, written by a newer Decks than this build (${LATEST}), which may misread it`);
	for (const one of pending) {
		if (!one.migrated?.(deck)) one.run(deck, options, (line) => said.push(line));
		writeVersion(deck, one.version);
	}
	// A deck from before versions, or with a plain number, already up to date: given its version, so the next start reads only it.
	if (record.version !== from && !pending.length) writeVersion(deck, from);
	return said;
}
