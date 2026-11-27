import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

/**
 * 2026-11-26: what a deck keeps on disk says card and canvas, as the code does.
 *
 * Boards became cards on 2026-10-30 and the stage became the canvas, and the code read the old names
 * wherever they had been written. This writes every one of them under its new name once, so nothing
 * else reads an old name:
 *
 * - a canvas's `canvas.json`: its `boards` list is `cards`;
 * - an agent's record (`.decks/agents/<id>/meta.json`): `stage`, the canvas it is on, is `canvas`, and
 *   the `canvas` a record from the days of shared canvases named is `fromCanvas`;
 * - the agents' chats and records: a message's pill of `kind` "board" is a "card";
 * - `deck.json`: the `boards` map of places an older build wrote is `places`;
 * - a shared canvas's file from before agents kept their own (`.decks/canvases/<name>.json`): `boards` is `cards`;
 * - a card's page (`canvases/<c>/cards/<n>/index.html`, and a page kept in a canvas's `boards/`):
 *   `<meta name="board">` is `<meta name="card">`, a `board` class on its body is `card-page`, and so
 *   is `.board` in its own styles, `lib/board.css` and `lib/board.js` are `card.css` and `card.js`,
 *   `window.__board` is `window.__card`, and a decision's `event.board` is `event.path`;
 * - a drawing's `decks.board` item, left on a canvas from before cards with no page of its own, is the
 *   plain web page item it was drawn as;
 * - the install's Allow decisions (`board-eval.json` in the data folder) are `app-trust.json`;
 * - the canvases' cached pictures (`.decks/thumbs/stages/`) go, to be drawn again under `canvases/`.
 *
 * A friend's canvas (`shared/canvases/`) is theirs and is left as it is, as every migration leaves it.
 *
 * Every file it changes is zipped first into `.decks/backups/`, and what it did is written in
 * `.decks/migrations.json`. It runs once, at start (`migrations/index.ts`).
 */
export const MIGRATION = "2026-11-26-card-and-canvas-names";

type Json = Record<string, unknown>;

const readJson = <T>(file: string): T | undefined => {
	try {
		return JSON.parse(readFileSync(file, "utf8")) as T;
	} catch {
		return undefined;
	}
};

const isObject = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);

/** Whether this migration has run on the deck: it records itself in `.decks/migrations.json`. */
export function migrated(deck: string): boolean {
	return !!readJson<Json>(join(deck, ".decks", "migrations.json"))?.[MIGRATION];
}

/** One file's change: its deck-relative path and its text after. */
export interface Rewrite {
	path: string;
	text: string;
	what: string;
}

export interface NamesPlan {
	rewrites: Rewrite[];
	/** The data folder's Allow decisions, renamed when there is one. */
	trust?: { from: string; to: string };
	/** The cached canvas pictures under their old folder, deleted. */
	thumbs?: string;
}

/** Every file under `dir` (absolute) whose name passes `keep`, as absolute paths. */
function filesUnder(dir: string, keep: (name: string) => boolean): string[] {
	const out: string[] = [];
	const walk = (at: string) => {
		let names: string[];
		try {
			names = readdirSync(at);
		} catch {
			return;
		}
		for (const name of names) {
			const full = join(at, name);
			let stat;
			try {
				stat = statSync(full);
			} catch {
				continue;
			}
			if (stat.isDirectory()) walk(full);
			else if (stat.isFile() && keep(name)) out.push(full);
		}
	};
	walk(dir);
	return out;
}

/** The deck's own canvas folders. A friend's, in `shared/canvases/`, is theirs, and is never touched. */
function canvasFolders(deck: string): string[] {
	const own = join(deck, "canvases");
	const folders: string[] = [];
	const list = (dir: string) => {
		try {
			return readdirSync(dir).filter((name) => statSync(join(dir, name)).isDirectory());
		} catch {
			return [];
		}
	};
	for (const name of list(own)) folders.push(join(own, name));
	return folders;
}

const stringify = (value: unknown, indent: string | number) => `${JSON.stringify(value, null, indent)}\n`;
const indentOf = (text: string) => (/^\{\n(\t| +)"/.exec(text)?.[1] ?? "\t");

/** A canvas's `canvas.json` with `boards` as `cards`. */
export function canvasMeta(text: string): string | undefined {
	const meta = (() => {
		try {
			return JSON.parse(text) as unknown;
		} catch {
			return undefined;
		}
	})();
	if (!isObject(meta) || !("boards" in meta)) return undefined;
	const { boards, ...rest } = meta;
	return stringify({ ...rest, cards: rest.cards ?? boards }, indentOf(text));
}

/** An agent's record with `stage` as `canvas`, and an older record's `canvas` (a shared canvas) as `fromCanvas`. */
export function agentRecord(text: string): string | undefined {
	let record: unknown;
	try {
		record = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (!isObject(record)) return undefined;
	const hasStage = typeof record.stage === "string";
	const oldCanvas = typeof record.canvas === "string" ? record.canvas : undefined;
	if (!hasStage && oldCanvas === undefined) return undefined;
	const { stage, canvas: _canvas, ...rest } = record;
	const next: Json = { ...rest };
	if (oldCanvas !== undefined && next.fromCanvas === undefined) next.fromCanvas = oldCanvas;
	if (hasStage) next.canvas = stage;
	return stringify(next, indentOf(text));
}

/** A chat or record that keeps message parts, with a "board" pill as a "card". */
export function pills(text: string): string | undefined {
	const next = text.replace(/("type"\s*:\s*"mention"\s*,\s*"kind"\s*:\s*)"board"/g, '$1"card"').replace(/("kind"\s*:\s*)"board"(\s*,\s*"id")/g, '$1"card"$2');
	return next === text ? undefined : next;
}

/** `deck.json` with its old `boards` map of places as `places`. */
export function deckFile(text: string): string | undefined {
	let file: unknown;
	try {
		file = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (!isObject(file) || !("boards" in file)) return undefined;
	const out: Json = {};
	for (const [key, value] of Object.entries(file)) {
		if (key === "boards") {
			if (!("places" in file)) out.places = value;
		} else out[key] = value;
	}
	return stringify(out, indentOf(text));
}

/** A shared canvas's file from before agents kept their own, with `boards` as `cards`. */
export function sharedCanvasFile(text: string): string | undefined {
	return canvasMeta(text);
}

/** `.board` as a class selector in CSS: not `.boards`, not `.board-x`, not `x.board.y`'s neighbours. */
const BOARD_CLASS = /\.board(?![\w-])/g;

/** A card's page with its old names: the meta tag, the body's class and the styles that name it, the library's files, its runtime. */
export function cardPage(text: string): string | undefined {
	let next = text
		.replace(/(<meta\s+name\s*=\s*["'])board(["'])/gi, "$1card$2")
		.replace(/(<body\b[^>]*\bclass\s*=\s*["'])([^"']*)(["'])/i, (_all, open: string, classes: string, close: string) => `${open}${classes.split(/\s+/).map((one) => (one === "board" ? "card-page" : one)).join(" ")}${close}`)
		.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (_all, open: string, css: string, close: string) => `${open}${css.replace(BOARD_CLASS, ".card-page")}${close}`)
		.replace(/\blib\/board\.(css|js)\b/g, "lib/card.$1")
		.replace(/\bwindow\.__board\b/g, "window.__card")
		.replace(/\bevent\.board\b/g, "event.path");
	// A script that names the body by its class, as `document.querySelector(".board")` or `body.board`.
	next = next.replace(/(["'`])\.board(?![\w-])/g, "$1.card-page").replace(/\bbody\.board(?![\w-])/g, "body.card-page");
	return next === text ? undefined : next;
}

/** A drawing whose `decks.board` items, from before cards, are plain web page items. */
export function drawing(text: string): string | undefined {
	let doc: unknown;
	try {
		doc = JSON.parse(text);
	} catch {
		return undefined;
	}
	let changed = false;
	const walk = (nodes: unknown) => {
		if (!Array.isArray(nodes)) return;
		for (const node of nodes) {
			if (!isObject(node)) continue;
			if (isObject(node.metadata) && node.metadata.type === "decks.board") {
				delete node.metadata;
				changed = true;
			}
			walk(node.children);
		}
	};
	if (isObject(doc)) walk(doc.children);
	return changed ? stringify(doc, indentOf(text)) : undefined;
}

/** What the migration would change in this deck (and the data folder, when given). */
export function planNames(deck: string, options: { dataDir?: string } = {}): NamesPlan {
	const rewrites: Rewrite[] = [];
	const add = (full: string, make: (text: string) => string | undefined, what: string) => {
		let text: string;
		try {
			text = readFileSync(full, "utf8");
		} catch {
			return;
		}
		const next = make(text);
		if (next !== undefined && next !== text) rewrites.push({ path: relative(deck, full).split(sep).join("/"), text: next, what });
	};
	for (const folder of canvasFolders(deck)) {
		add(join(folder, "canvas.json"), canvasMeta, "canvas.json");
		add(join(folder, "canvas.pen"), drawing, "drawing");
		for (const under of ["cards", "boards"]) for (const page of filesUnder(join(folder, under), (name) => /\.html?$/i.test(name))) add(page, cardPage, "card page");
	}
	const agents = join(deck, ".decks", "agents");
	for (const file of filesUnder(agents, (name) => /\.jsonl?$/i.test(name))) {
		add(file, (text) => {
			const records = /[/\\]meta\.json$/.test(file) ? agentRecord(text) : undefined;
			const base = records ?? text;
			const parts = pills(base);
			return parts ?? records;
		}, "agent");
	}
	add(join(deck, "deck.json"), deckFile, "deck.json");
	for (const file of filesUnder(join(deck, ".decks", "canvases"), (name) => name.endsWith(".json"))) add(file, sharedCanvasFile, "shared canvas");
	const plan: NamesPlan = { rewrites };
	if (options.dataDir) {
		const from = join(options.dataDir, "board-eval.json");
		const to = join(options.dataDir, "app-trust.json");
		if (existsSync(from) && !existsSync(to)) plan.trust = { from, to };
	}
	const thumbs = join(deck, ".decks", "thumbs", "stages");
	if (existsSync(thumbs)) plan.thumbs = thumbs;
	return plan;
}

/** The plan in lines, for the log and a dry run. */
export function describeNames(plan: NamesPlan): string[] {
	const counts = new Map<string, number>();
	for (const one of plan.rewrites) counts.set(one.what, (counts.get(one.what) ?? 0) + 1);
	const lines = [...counts].map(([what, n]) => `would write ${n} ${what} file(s) with their new names`);
	if (plan.trust) lines.push(`would rename ${plan.trust.from} to ${plan.trust.to}`);
	if (plan.thumbs) lines.push(`would delete the cached canvas pictures in ${plan.thumbs}`);
	return lines;
}

/** Run it: back up, rewrite, record. */
export function migrateNames(deck: string, options: { dataDir?: string; dryRun?: boolean; log?: (line: string) => void; now?: Date } = {}): { plan: NamesPlan; ran: boolean; backup?: string } {
	const log = options.log ?? (() => {});
	const plan = planNames(deck, options.dataDir ? { dataDir: options.dataDir } : {});
	if (options.dryRun) {
		for (const line of describeNames(plan)) log(line);
		return { plan, ran: false };
	}
	if (migrated(deck)) return { plan: { rewrites: [] }, ran: false };
	const now = options.now ?? new Date();
	const stamp = now.toISOString().replace(/[:.]/g, "-");
	let backup: string | undefined;
	if (plan.rewrites.length) {
		backup = `.decks/backups/${stamp}-before-card-and-canvas-names.zip`;
		mkdirSync(dirname(join(deck, backup)), { recursive: true });
		const paths = plan.rewrites.map((one) => one.path);
		// In chunks, so a deck of thousands of cards stays under the argument limit.
		for (let at = 0; at < paths.length; at += 500) execFileSync("zip", ["-q", join(deck, backup), ...paths.slice(at, at + 500)], { cwd: deck, stdio: ["ignore", "ignore", "pipe"] });
		log(`backed up the ${paths.length} file(s) it rewrites to ${backup}`);
	}
	for (const one of plan.rewrites) writeFileSync(join(deck, one.path), one.text);
	if (plan.trust) renameSync(plan.trust.from, plan.trust.to);
	if (plan.thumbs) rmSync(plan.thumbs, { recursive: true, force: true });
	const record = join(deck, ".decks", "migrations.json");
	const done = readJson<Json>(record) ?? {};
	mkdirSync(dirname(record), { recursive: true });
	const counts = Object.fromEntries(["canvas.json", "drawing", "card page", "agent", "deck.json", "shared canvas"].map((what) => [what, plan.rewrites.filter((one) => one.what === what).length]));
	writeFileSync(record, `${JSON.stringify({ ...done, [MIGRATION]: { at: now.toISOString(), ...(backup ? { backup } : {}), ...counts, ...(plan.trust ? { trust: true } : {}) } }, null, "\t")}\n`);
	return { plan, ran: true, ...(backup ? { backup } : {}) };
}
