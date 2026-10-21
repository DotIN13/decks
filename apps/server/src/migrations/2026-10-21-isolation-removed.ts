import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * 2026-10-21: isolated mode is gone, and what it left on disk becomes ordinary.
 *
 * Isolated mode ran an agent in a temporary copy of its canvas. What it kept in the deck was small:
 *
 * - on the agent's record (`.decks/agents/<id>/meta.json`), `isolated: true` and `isolatedStages`,
 *   the canvases it had used while isolated;
 * - in an isolated canvas's folder, `isolated.json` (the canvas it was copied from), and in a canvas
 *   copied back when isolation ended, `from-isolation.json`.
 *
 * Isolated canvases were always ordinary folders in `canvases/<name>/`, their boards in its
 * `boards/`, so nothing moves and no name can clash: the two marker files are removed, and the
 * agent's two fields are dropped, so it is an ordinary agent on the canvas it was on. The files
 * it changes are zipped first into `.decks/backups/`. It runs once, at start
 * (`migrations/index.ts`), and says so in `.decks/migrations.json`.
 */
export const MIGRATION = "2026-10-21-isolation-removed";

const MARKS = ["isolated.json", "from-isolation.json"];

export interface IsolationPlan {
	/** Deck-relative marker files to remove. */
	marks: string[];
	/** Deck-relative agent records with an isolation field to drop. */
	agents: string[];
}

const readJson = <T>(file: string): T | undefined => {
	try {
		return JSON.parse(readFileSync(file, "utf8")) as T;
	} catch {
		return undefined;
	}
};

/** Whether this deck has run the migration already. */
export function migrated(deck: string): boolean {
	return !!readJson<Record<string, unknown>>(join(deck, ".decks", "migrations.json"))?.[MIGRATION];
}

/** What isolated mode left in this deck. */
export function planIsolation(deck: string): IsolationPlan {
	const marks: string[] = [];
	const canvases = join(deck, "canvases");
	if (existsSync(canvases)) {
		for (const entry of readdirSync(canvases, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			if (!entry.isDirectory()) continue;
			for (const mark of MARKS) if (existsSync(join(canvases, entry.name, mark))) marks.push(`canvases/${entry.name}/${mark}`);
		}
	}
	const agents: string[] = [];
	const records = join(deck, ".decks", "agents");
	if (existsSync(records)) {
		for (const entry of readdirSync(records, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			if (!entry.isDirectory()) continue;
			const record = readJson<Record<string, unknown>>(join(records, entry.name, "meta.json"));
			if (record && ("isolated" in record || "isolatedStages" in record)) agents.push(`.decks/agents/${entry.name}/meta.json`);
		}
	}
	return { marks, agents };
}

/** The lines a dry run prints. */
export function describeIsolation(plan: IsolationPlan): string[] {
	return [
		...plan.marks.map((path) => `remove   ${path}`),
		...plan.agents.map((path) => `ordinary ${path} (isolated mode dropped)`),
		`isolated mode: ${plan.marks.length} marker file${plan.marks.length === 1 ? "" : "s"}, ${plan.agents.length} agent${plan.agents.length === 1 ? "" : "s"}`,
	];
}

/** Run it, once: back up what it changes, remove the markers, drop the fields, and record. */
export function migrateIsolation(deck: string, options: { dryRun?: boolean; log?: (line: string) => void; now?: Date } = {}): { plan: IsolationPlan; ran: boolean; backup?: string } {
	const log = options.log ?? (() => {});
	const plan = planIsolation(deck);
	if (options.dryRun) {
		for (const line of describeIsolation(plan)) log(line);
		return { plan, ran: false };
	}
	if (migrated(deck)) return { plan, ran: false };
	const now = options.now ?? new Date();
	let backup: string | undefined;
	const files = [...plan.marks, ...plan.agents];
	if (files.length) {
		backup = `.decks/backups/${now.toISOString().replace(/[:.]/g, "-")}-before-isolation-removed.zip`;
		mkdirSync(dirname(join(deck, backup)), { recursive: true });
		// Only the files it changes: nothing else is touched. Refused loudly without `zip`, since nothing changes without a backup.
		execFileSync("zip", ["-q", join(deck, backup), ...files], { cwd: deck, stdio: ["ignore", "ignore", "pipe"] });
		log(`backed up what isolated mode left to ${backup}`);
	}
	for (const path of plan.marks) rmSync(join(deck, path), { force: true });
	for (const path of plan.agents) {
		const file = join(deck, path);
		const record = readJson<Record<string, unknown>>(file);
		if (!record) continue;
		delete record.isolated;
		delete record.isolatedStages;
		// As the store writes a record (`agents/store.ts`).
		writeFileSync(file, JSON.stringify(record, null, 2));
	}
	const file = join(deck, ".decks", "migrations.json");
	const done = readJson<Record<string, unknown>>(file) ?? {};
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, `${JSON.stringify({ ...done, [MIGRATION]: { at: now.toISOString(), ...(backup ? { backup } : {}), marks: plan.marks.length, agents: plan.agents.length } }, null, "\t")}\n`);
	return { plan, ran: true, ...(backup ? { backup } : {}) };
}
