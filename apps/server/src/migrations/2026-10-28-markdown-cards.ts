import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

/**
 * 2026-10-28: markdown cards take a tag of their own, `decks.markdown-card`.
 *
 * A markdown card is a pen frame tagged `decks.card`. That tag now names an HTML card, a `browser`
 * item drawn in a shadow root of the stage's page (`packages/canvas/src/items/card.ts`). The two never
 * clashed, one being a frame and the other a browser item, but one name for two things would, so the
 * frames are rewritten: every frame tagged `decks.card` in the deck's own drawings (`canvases/<name>/
 * canvas.pen`, their `frames/`, and the deck's `frames/`) becomes `decks.markdown-card`.
 *
 * A friend's canvas (`shared/canvases/…`) is theirs and is left as it is; every reader takes a frame
 * with the old tag as a markdown card (`isCard`, the engine's painter), so nothing depends on this
 * having run. The files it changes are zipped first into `.decks/backups/`. It runs once, at start
 * (`migrations/index.ts`), and says so in `.decks/migrations.json`.
 */
export const MIGRATION = "2026-10-28-markdown-cards";
const OLD = "decks.card";
const NEW = "decks.markdown-card";

interface Node {
	type?: unknown;
	metadata?: { type?: unknown; [key: string]: unknown };
	children?: unknown;
	[key: string]: unknown;
}

export interface MarkdownCardsPlan {
	/** Deck-relative drawings with old-tagged frames, and how many each holds. */
	files: Array<{ path: string; frames: number }>;
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

/** Every frame with the old tag, rewritten in place; how many there were. */
function retag(nodes: unknown, write: boolean): number {
	if (!Array.isArray(nodes)) return 0;
	let count = 0;
	for (const node of nodes as Node[]) {
		if (!node || typeof node !== "object") continue;
		if (node.type === "frame" && node.metadata?.type === OLD) {
			count++;
			if (write) node.metadata = { ...node.metadata, type: NEW };
		}
		count += retag(node.children, write);
	}
	return count;
}

/** The deck's own drawings: each canvas's `canvas.pen` and `frames/`, and the deck's `frames/`. */
function drawings(deck: string): string[] {
	const out: string[] = [];
	const pens = (dir: string) => {
		if (!existsSync(dir)) return;
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.name.startsWith(".")) continue;
			const full = join(dir, entry.name);
			if (entry.isDirectory()) pens(full);
			else if (entry.name.endsWith(".pen")) out.push(full);
		}
	};
	const canvases = join(deck, "canvases");
	if (existsSync(canvases)) {
		for (const entry of readdirSync(canvases, { withFileTypes: true })) {
			if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
			const pen = join(canvases, entry.name, "canvas.pen");
			if (existsSync(pen)) out.push(pen);
			pens(join(canvases, entry.name, "frames"));
		}
	}
	pens(join(deck, "frames"));
	return out.sort();
}

/** What would change. */
export function planMarkdownCards(deck: string): MarkdownCardsPlan {
	const files: MarkdownCardsPlan["files"] = [];
	for (const file of drawings(deck)) {
		const doc = readJson<{ children?: unknown }>(file);
		const frames = doc ? retag(doc.children, false) : 0;
		if (frames) files.push({ path: relative(deck, file), frames });
	}
	return { files };
}

/** The lines a dry run prints. */
export function describeMarkdownCards(plan: MarkdownCardsPlan): string[] {
	const total = plan.files.reduce((sum, file) => sum + file.frames, 0);
	return [...plan.files.map((file) => `retag    ${file.path} (${file.frames} markdown card${file.frames === 1 ? "" : "s"})`), `markdown cards: ${total} in ${plan.files.length} drawing${plan.files.length === 1 ? "" : "s"} become ${NEW}`];
}

/** Run it, once: back up the drawings it changes, retag their frames, and record. */
export function migrateMarkdownCards(deck: string, options: { dryRun?: boolean; log?: (line: string) => void; now?: Date } = {}): { plan: MarkdownCardsPlan; ran: boolean; backup?: string } {
	const log = options.log ?? (() => {});
	const plan = planMarkdownCards(deck);
	if (options.dryRun) {
		for (const line of describeMarkdownCards(plan)) log(line);
		return { plan, ran: false };
	}
	if (migrated(deck)) return { plan, ran: false };
	const now = options.now ?? new Date();
	let backup: string | undefined;
	if (plan.files.length) {
		backup = `.decks/backups/${now.toISOString().replace(/[:.]/g, "-")}-before-markdown-cards.zip`;
		mkdirSync(dirname(join(deck, backup)), { recursive: true });
		// Only the drawings it changes. Refused loudly without `zip`, since nothing changes without a backup.
		execFileSync("zip", ["-q", join(deck, backup), ...plan.files.map((file) => file.path)], { cwd: deck, stdio: ["ignore", "ignore", "pipe"] });
		log(`backed up the drawings with markdown cards to ${backup}`);
	}
	for (const { path } of plan.files) {
		const file = join(deck, path);
		const text = readFileSync(file, "utf8");
		const doc = JSON.parse(text) as { children?: unknown };
		retag(doc.children, true);
		// In the file's own indent: tabs or two spaces, as pen writes it.
		const indent = /\n\t/.test(text) ? "\t" : 2;
		writeFileSync(file, `${JSON.stringify(doc, null, indent)}\n`);
	}
	const file = join(deck, ".decks", "migrations.json");
	const done = readJson<Record<string, unknown>>(file) ?? {};
	mkdirSync(dirname(file), { recursive: true });
	const frames = plan.files.reduce((sum, one) => sum + one.frames, 0);
	writeFileSync(file, `${JSON.stringify({ ...done, [MIGRATION]: { at: now.toISOString(), ...(backup ? { backup } : {}), drawings: plan.files.length, frames } }, null, "\t")}\n`);
	return { plan, ran: true, ...(backup ? { backup } : {}) };
}
