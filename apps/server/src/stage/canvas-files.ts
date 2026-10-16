import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { slug } from "../agents/slug.ts";

/**
 * Where a deck keeps its canvases: `canvases/<name>/canvas.pen`, with the name the person reads in
 * `canvas.json` beside it. A canvas is the deck's, not an agent's: its folder is named for what is on
 * it, and an agent only points at the one it is working on (`agents/session.ts`).
 *
 * Decks before 2026-10-16 kept them as `stages/<name>/stage.pen` and `stage.json`, most folders named
 * after the agent that first drew there. `migrateStages` moves those once, when the deck opens.
 */
export const CANVAS_DIR = "canvases";
export const CANVAS_FILE = "canvas.pen";
export const CANVAS_META = "canvas.json";

/** The deck-relative path of a canvas's drawing. */
export const canvasFile = (name: string): string => `${CANVAS_DIR}/${name}/${CANVAS_FILE}`;

const OLD_DIR = "stages";
const OLD_FILE = "stage.pen";
const OLD_META = "stage.json";

/** A deck-relative path written before the move, pointed at where it is now: `stages/<n>/…` → `canvases/<m>/…`. */
export function movedPath(path: string, renamed: ReadonlyMap<string, string>): string {
	const match = /^stages\/([^/]+)(\/.*)?$/.exec(path);
	if (!match) return path;
	const name = renamed.get(match[1]!) ?? match[1]!;
	const rest = (match[2] ?? "").replace(/^\/stage\.pen$/, `/${CANVAS_FILE}`).replace(/^\/stage\.json$/, `/${CANVAS_META}`);
	return `${CANVAS_DIR}/${name}${rest}`;
}

/**
 * Move a deck's `stages/` to `canvases/`, once. A canvas with a title gets a folder named from it;
 * one without keeps its folder and is marked as named by nobody, so the first title it is given
 * names the folder too (`stage/stage-admin.ts`). Agents' records are pointed at the new names, and
 * board items whose board was kept in a canvas's own folder follow it. Returns old name → new name.
 */
export function migrateStages(deck: string): Map<string, string> {
	const renamed = new Map<string, string>();
	const from = join(deck, OLD_DIR);
	const to = join(deck, CANVAS_DIR);
	if (!existsSync(from) || existsSync(to)) return renamed;
	const names = readdirSync(from, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => entry.name);
	const taken = new Set<string>();
	const plan: Array<{ old: string; name: string; title?: string; provisional: boolean }> = [];
	for (const old of names.sort()) {
		let meta: { title?: unknown; provisional?: unknown } = {};
		try {
			meta = JSON.parse(readFileSync(join(from, old, OLD_META), "utf8")) as typeof meta;
		} catch {
			/* no title: the folder's name is all it has */
		}
		const title = typeof meta.title === "string" && meta.title.trim() ? meta.title.trim() : undefined;
		const provisional = !title || meta.provisional === true;
		const base = (!provisional && title && slug(title, 40)) || old;
		let name = base;
		for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
		taken.add(name);
		plan.push({ old, name, ...(title ? { title } : {}), provisional });
	}
	renameSync(from, to);
	for (const { old, name, title, provisional } of plan) {
		if (old !== name) renameSync(join(to, old), join(to, name));
		renamed.set(old, name);
		const dir = join(to, name);
		if (existsSync(join(dir, OLD_FILE))) renameSync(join(dir, OLD_FILE), join(dir, CANVAS_FILE));
		let meta: Record<string, unknown> = {};
		try {
			meta = JSON.parse(readFileSync(join(dir, OLD_META), "utf8")) as Record<string, unknown>;
			renameSync(join(dir, OLD_META), join(dir, CANVAS_META));
		} catch {
			/* written below */
		}
		writeFileSync(join(dir, CANVAS_META), `${JSON.stringify({ ...meta, title: title ?? old, ...(provisional ? { provisional: true } : {}) }, null, "\t")}\n`);
	}
	for (const { name } of plan) {
		const file = join(to, name, CANVAS_FILE);
		if (!existsSync(file)) continue;
		const text = readFileSync(file, "utf8");
		const next = text.replace(/stages\/([^/"]+)\/boards\//g, (_all, old: string) => `${CANVAS_DIR}/${renamed.get(old) ?? old}/boards/`);
		if (next !== text) writeFileSync(file, next);
		const mark = join(to, name, "isolated.json");
		try {
			const parsed = JSON.parse(readFileSync(mark, "utf8")) as { from?: string };
			if (parsed.from && renamed.has(parsed.from)) writeFileSync(mark, `${JSON.stringify({ ...parsed, from: renamed.get(parsed.from) })}\n`);
		} catch {
			/* not an isolated copy */
		}
	}
	migrateAgentRecords(deck, renamed);
	return renamed;
}

/** Point each agent's record at its canvas's new folder, and at boards that moved with it. */
function migrateAgentRecords(deck: string, renamed: ReadonlyMap<string, string>): void {
	const agents = join(deck, ".decks", "agents");
	if (!existsSync(agents)) return;
	const repoint = (path: unknown) => (typeof path === "string" ? movedPath(path, renamed) : path);
	for (const entry of readdirSync(agents, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const file = join(agents, entry.name, "meta.json");
		let record: Record<string, unknown>;
		try {
			record = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
		} catch {
			continue;
		}
		const next = { ...record };
		if (typeof record.stage === "string") next.stage = renamed.get(record.stage) ?? record.stage;
		if (Array.isArray(record.isolatedStages)) next.isolatedStages = record.isolatedStages.map((one) => (typeof one === "string" ? (renamed.get(one) ?? one) : one));
		if (Array.isArray(record.context)) next.context = record.context.map(repoint);
		if (Array.isArray(record.inPlay)) next.inPlay = record.inPlay.map(repoint);
		if (record.positions && typeof record.positions === "object") {
			next.positions = Object.fromEntries(Object.entries(record.positions as Record<string, unknown>).map(([path, at]) => [movedPath(path, renamed), at]));
		}
		if (JSON.stringify(next) !== JSON.stringify(record)) writeFileSync(file, `${JSON.stringify(next, null, "\t")}\n`);
	}
}
