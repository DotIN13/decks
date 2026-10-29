import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";

/**
 * 2026-10-29: a document board and an app board become items of the drawing.
 *
 * A board whose page is one document box (`data-live="doc"`, `data-path`) or one app (`data-live="app"`,
 * `data-app`) was a page of its own, framed on the canvas. In the canvas frame a page inherits the
 * frame's sandbox, with no storage and no app; and neither needs a page. So each becomes an item with
 * no file of its own (`packages/canvas/src/drawing.ts`, `itemKind`):
 *
 * - `{ type: "browser", metadata: { type: "decks.document", path } }`, `path` as the deck names the file;
 * - `{ type: "browser", metadata: { type: "decks.app", name } }`.
 *
 * The item keeps its id, place, size and name, so arrows to it still join. The board's file is left
 * where it is, for the boards' retirement to take. Only the deck's own canvases: a friend's is theirs.
 * The drawings it changes are zipped first into `.decks/backups/`. It runs once, at start
 * (`migrations/index.ts`), and says so in `.decks/migrations.json`.
 */
export const MIGRATION = "2026-10-29-documents-and-apps";

interface Node {
	id?: unknown;
	type?: unknown;
	name?: unknown;
	metadata?: { type?: unknown; path?: unknown; [key: string]: unknown };
	children?: unknown;
	[key: string]: unknown;
}

export interface DocumentsAndAppsPlan {
	/** Deck-relative drawings, and the items in each that change. */
	files: Array<{ path: string; items: Array<{ id: string; board: string; becomes: "document" | "app"; names: string }> }>;
}

const readJson = <T>(file: string): T | undefined => {
	try {
		return JSON.parse(readFileSync(file, "utf8")) as T;
	} catch {
		return undefined;
	}
};

export function migrated(deck: string): boolean {
	return !!readJson<Record<string, unknown>>(join(deck, ".decks", "migrations.json"))?.[MIGRATION];
}

/** What a board's page is, read off its one live box: a document and its file, an app and its name. */
export function boardIsItem(html: string): { document: string } | { app: string } | undefined {
	const box = /<[a-z]+\b[^>]*\bdata-live\s*=\s*["'](doc|app)["'][^>]*>/i.exec(html);
	if (!box) return undefined;
	const attr = (name: string) => new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(box[0])?.[1];
	if (box[1]!.toLowerCase() === "doc") {
		const path = attr("data-path");
		return path ? { document: path } : undefined;
	}
	const app = attr("data-app");
	return app ? { app } : undefined;
}

/** A document's file as the deck names it: its box's `data-path` is read from the board's folder, unless absolute. */
function deckPath(raw: string, board: string): string {
	if (raw.startsWith("/") || raw.startsWith("~")) return raw;
	return posix.normalize(posix.join(posix.dirname(board), raw));
}

/** The top-level items of a canvas that are such boards, rewritten in place when `write`. */
function convert(deck: string, canvas: string, nodes: unknown, write: boolean): DocumentsAndAppsPlan["files"][number]["items"] {
	const out: DocumentsAndAppsPlan["files"][number]["items"] = [];
	if (!Array.isArray(nodes)) return out;
	for (const node of nodes as Node[]) {
		if (!node || typeof node !== "object" || node.type !== "browser" || node.metadata?.type !== "decks.board" || typeof node.metadata.path !== "string") continue;
		// A board's path in its canvas's drawing is the canvas's own (`boards/a.html`), or the deck's.
		const given = node.metadata.path;
		const board = given.startsWith("canvases/") || given.startsWith("shared/") ? given : `canvases/${canvas}/${given}`;
		const file = join(deck, board);
		if (!existsSync(file)) continue;
		const is = boardIsItem(readFileSync(file, "utf8"));
		if (!is) continue;
		const becomes = "document" in is ? "document" : "app";
		const names = "document" in is ? deckPath(is.document, board) : is.app;
		out.push({ id: String(node.id), board, becomes, names });
		if (!write) continue;
		node.metadata = becomes === "document" ? { type: "decks.document", path: names } : { type: "decks.app", name: names };
	}
	return out;
}

/** Each of the deck's own canvases' drawings. */
function drawings(deck: string): Array<{ canvas: string; file: string }> {
	const canvases = join(deck, "canvases");
	if (!existsSync(canvases)) return [];
	return readdirSync(canvases, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
		.map((entry) => ({ canvas: entry.name, file: join(canvases, entry.name, "canvas.pen") }))
		.filter((one) => existsSync(one.file))
		.sort((a, b) => a.canvas.localeCompare(b.canvas));
}

export function planDocumentsAndApps(deck: string): DocumentsAndAppsPlan {
	const files: DocumentsAndAppsPlan["files"] = [];
	for (const { canvas, file } of drawings(deck)) {
		const doc = readJson<{ children?: unknown }>(file);
		const items = doc ? convert(deck, canvas, doc.children, false) : [];
		if (items.length) files.push({ path: `canvases/${canvas}/canvas.pen`, items });
	}
	return { files };
}

export function describeDocumentsAndApps(plan: DocumentsAndAppsPlan): string[] {
	const items = plan.files.flatMap((file) => file.items);
	return [
		...items.map((item) => `${item.becomes.padEnd(9)}${item.board} -> ${item.names}`),
		`documents and apps: ${items.filter((one) => one.becomes === "document").length} document and ${items.filter((one) => one.becomes === "app").length} app board(s) in ${plan.files.length} canvas(es) become items`,
	];
}

/** Run it, once: back up the drawings it changes, rewrite their items, and record. */
export function migrateDocumentsAndApps(deck: string, options: { dryRun?: boolean; log?: (line: string) => void; now?: Date } = {}): { plan: DocumentsAndAppsPlan; ran: boolean; backup?: string } {
	const log = options.log ?? (() => {});
	const plan = planDocumentsAndApps(deck);
	if (options.dryRun) {
		for (const line of describeDocumentsAndApps(plan)) log(line);
		return { plan, ran: false };
	}
	if (migrated(deck)) return { plan, ran: false };
	const now = options.now ?? new Date();
	let backup: string | undefined;
	if (plan.files.length) {
		backup = `.decks/backups/${now.toISOString().replace(/[:.]/g, "-")}-before-documents-and-apps.zip`;
		mkdirSync(dirname(join(deck, backup)), { recursive: true });
		execFileSync("zip", ["-q", join(deck, backup), ...plan.files.map((file) => file.path)], { cwd: deck, stdio: ["ignore", "ignore", "pipe"] });
		log(`backed up the drawings with document and app boards to ${backup}`);
	}
	for (const { path } of plan.files) {
		const file = join(deck, path);
		const text = readFileSync(file, "utf8");
		const doc = JSON.parse(text) as { children?: unknown };
		convert(deck, path.split("/")[1]!, doc.children, true);
		const indent = /\n\t/.test(text) ? "\t" : 2;
		writeFileSync(file, `${JSON.stringify(doc, null, indent)}\n`);
	}
	const record = join(deck, ".decks", "migrations.json");
	const done = readJson<Record<string, unknown>>(record) ?? {};
	mkdirSync(dirname(record), { recursive: true });
	const items = plan.files.reduce((sum, one) => sum + one.items.length, 0);
	writeFileSync(record, `${JSON.stringify({ ...done, [MIGRATION]: { at: now.toISOString(), ...(backup ? { backup } : {}), drawings: plan.files.length, items } }, null, "\t")}\n`);
	return { plan, ran: true, ...(backup ? { backup } : {}) };
}
