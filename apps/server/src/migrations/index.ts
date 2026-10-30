import { migrateStages } from "./2026-10-16-stages-to-canvases.ts";
import { describe, migrated, migrateStandalone } from "./2026-10-20-standalone-canvases.ts";
import { migrated as isolationMigrated, migrateIsolation } from "./2026-10-21-isolation-removed.ts";
import { migrated as markdownCardsMigrated, migrateMarkdownCards } from "./2026-10-28-markdown-cards.ts";
import { migrated as documentsAndAppsMigrated, migrateDocumentsAndApps } from "./2026-10-29-documents-and-apps.ts";
import { migrated as boardsToCardsMigrated, migrateBoardsToCards } from "./2026-10-29-boards-to-cards.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { derivedVersion, holdsADeck, readRecord, writeVersion } from "./version.ts";

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
 * Each at-open migration has a version, its place in `MIGRATIONS`, and the deck keeps the last one run
 * on it in `.decks/migrations.json` (`version.ts`). A deck at `LATEST` opens without any migration
 * looking at it; one behind runs only the migrations after its version, oldest first, and moves its
 * version on after each, so a start cut short goes on from where it stopped. A new deck starts at
 * `LATEST`. A new migration goes at the end of `MIGRATIONS` with the next version.
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
	/** Its place in the order, from 1; never reused or renumbered. */
	version: number;
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
		version: 1,
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
		version: 2,
		id: "2026-10-20-standalone-canvases",
		migrated,
		run: (deck, options, say) => {
			const { plan, ran, backup } = migrateStandalone(deck, { ...(options.dataDir ? { dataDir: options.dataDir } : {}), log: say });
			if (ran && plan.canvases) [describe(plan).at(-1)!, ...(backup ? [`the deck as it was is in ${backup}`] : [])].forEach(say);
		},
		dryRun: (deck, log) => void migrateStandalone(deck, { dryRun: true, log }),
	},
	{
		version: 3,
		id: "2026-10-21-isolation-removed",
		migrated: isolationMigrated,
		run: (deck, _options, say) => {
			const { plan, ran, backup } = migrateIsolation(deck, { log: say });
			if (ran && (plan.marks.length || plan.agents.length)) [`isolated mode is gone: ${plan.agents.length} agent(s) and the canvases they used are ordinary now`, ...(backup ? [`what changed is backed up in ${backup}`] : [])].forEach(say);
		},
		dryRun: (deck, log) => void migrateIsolation(deck, { dryRun: true, log }),
	},
	{
		version: 4,
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
		version: 5,
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
		version: 6,
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
export const LATEST = MIGRATIONS.at(-1)!.version;

/** The deck's version: its number, or for a deck from before numbers, the one its record implies. */
export function deckVersion(deck: string): number {
	const record = readRecord(deck);
	return typeof record.version === "number" ? record.version : derivedVersion(record, MIGRATIONS, deck);
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
	const numbered = typeof record.version === "number";
	const from = numbered ? (record.version as number) : derivedVersion(record, MIGRATIONS, deck);
	const pending = MIGRATIONS.filter((one) => one.version > from);
	if (dryRun) {
		const lines: string[] = [];
		for (const one of pending) if (!one.migrated?.(deck)) one.dryRun(deck, (line) => lines.push(line));
		if (!pending.length) lines.push(`${deck} is migrated already (version ${from}): nothing to do.`);
		else lines.push(`${deck} is at version ${from}; ${pending.length} migration(s) would run, to version ${LATEST}.`);
		throw new DryRun(lines);
	}
	const said: string[] = [];
	if (from > LATEST) said.push(`this deck is at version ${from}, newer than this build knows (${LATEST}): it was opened by a newer Decks`);
	for (const one of pending) {
		if (!one.migrated?.(deck)) one.run(deck, options, (line) => said.push(line));
		writeVersion(deck, one.version);
	}
	// A deck from before numbers, already up to date: given its number, so the next start reads only it.
	if (!numbered && !pending.length) writeVersion(deck, from);
	return said;
}
