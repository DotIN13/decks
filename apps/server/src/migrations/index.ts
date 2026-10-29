import { migrateStages } from "./2026-10-16-stages-to-canvases.ts";
import { describe, migrated, migrateStandalone } from "./2026-10-20-standalone-canvases.ts";
import { migrated as isolationMigrated, migrateIsolation } from "./2026-10-21-isolation-removed.ts";
import { migrated as markdownCardsMigrated, migrateMarkdownCards } from "./2026-10-28-markdown-cards.ts";
import { migrated as documentsAndAppsMigrated, migrateDocumentsAndApps } from "./2026-10-29-documents-and-apps.ts";

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

/**
 * The at-open migrations, in order. Returns a line for the log per migration that changed anything.
 * `dataDir` is the install's data folder, where its Allow decisions are kept; `dryRun` throws a
 * `DryRun` with every move, having written nothing.
 */
export function runAtOpen(deck: string, options: { dataDir?: string; dryRun?: boolean } = {}): string[] {
	const said: string[] = [];
	const dryRun = options.dryRun ?? process.env.DECKS_MIGRATE_DRY_RUN === "1";
	if (dryRun) {
		const lines: string[] = [];
		if (!migrated(deck)) migrateStandalone(deck, { dryRun: true, log: (line) => lines.push(line) });
		if (!isolationMigrated(deck)) migrateIsolation(deck, { dryRun: true, log: (line) => lines.push(line) });
		if (!markdownCardsMigrated(deck)) migrateMarkdownCards(deck, { dryRun: true, log: (line) => lines.push(line) });
		if (!documentsAndAppsMigrated(deck)) migrateDocumentsAndApps(deck, { dryRun: true, log: (line) => lines.push(line) });
		if (migrated(deck) && isolationMigrated(deck) && markdownCardsMigrated(deck) && documentsAndAppsMigrated(deck)) lines.push(`${deck} is migrated already: nothing to do.`);
		throw new DryRun(lines);
	}
	const moved = migrateStages(deck);
	if (moved.size) said.push(`moved ${moved.size} canvases from stages/ to canvases/`);
	if (!migrated(deck)) {
		const { plan, ran, backup } = migrateStandalone(deck, { ...(options.dataDir ? { dataDir: options.dataDir } : {}), log: (line) => said.push(line) });
		if (ran && plan.canvases) said.push(describe(plan).at(-1)!, ...(backup ? [`the deck as it was is in ${backup}`] : []));
	}
	if (!isolationMigrated(deck)) {
		const { plan, ran, backup } = migrateIsolation(deck, { log: (line) => said.push(line) });
		if (ran && (plan.marks.length || plan.agents.length)) said.push(`isolated mode is gone: ${plan.agents.length} agent(s) and the canvases they used are ordinary now`, ...(backup ? [`what changed is backed up in ${backup}`] : []));
	}
	if (!markdownCardsMigrated(deck)) {
		const { plan, ran, backup } = migrateMarkdownCards(deck, { log: (line) => said.push(line) });
		const frames = plan.files.reduce((sum, file) => sum + file.frames, 0);
		if (ran && frames) said.push(`markdown cards are decks.markdown-card now: ${frames} in ${plan.files.length} drawing(s)`, ...(backup ? [`the drawings as they were are in ${backup}`] : []));
	}
	if (!documentsAndAppsMigrated(deck)) {
		const { plan, ran, backup } = migrateDocumentsAndApps(deck, { log: (line) => said.push(line) });
		const items = plan.files.reduce((sum, file) => sum + file.items.length, 0);
		if (ran && items) said.push(`document and app boards are items now: ${items} in ${plan.files.length} canvas(es)`, ...(backup ? [`the drawings as they were are in ${backup}`] : []));
	}
	return said;
}
