import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { applyEdits, capped, globMatcher, isText, LIMIT, matchLines, MAX_READ, MAX_WRITE, pathParts, Refused, searchPattern, sliceLines, type TextEdit, type TextMatch, type TextSlice } from "@decks/deck-kit";

/**
 * The deck's files, for a caller with no disk: list, find, read, write, edit, search, move, delete.
 *
 * An agent with a shell works on the deck with its own tools, and these are for the client that has
 * none (an MCP session on another machine, the iPad app). They reach the deck folder and nothing
 * else: a path is from the deck's root, never absolute, never upward, and never through a hidden
 * folder (`.decks` holds tokens and conversations, `.git` the history) or a link that leaves the deck.
 * `lib/` is the deck's copy of Decks's own libraries and is read only. Reading and searching take
 * text; a picture or a film is embedded by its address (`file.url`), not read.
 *
 * The rules (which paths, how a read is cut, how an edit lands, what a search answers) are
 * `@decks/deck-kit`'s, the same wherever a deck is kept; here they meet the disk. Pure of the server:
 * every function takes the deck's root. The calls are `verbs/files.ts`.
 */

export interface DeckFile {
	path: string;
	size: number;
	/** When it last changed, epoch milliseconds: also its revision, for a write that must not overwrite a newer one. */
	at: number;
	dir?: true;
}

export { LIMIT };
/** Folders a walk never enters: dependencies and build output are not the deck's content. */
const SKIPPED = new Set(["node_modules", "dist", "build"]);

/**
 * A path a caller named, as an absolute path inside the deck, or a refusal that says why. `write`
 * also refuses `lib/` and the deck's own root.
 */
export function resolveIn(root: string, asked: unknown, options: { write?: boolean } = {}): string {
	const parts = pathParts(asked, options);
	const full = join(root, ...parts);
	// A link may point anywhere: what exists of the path must still be inside the deck once links are followed.
	let there = full;
	while (!existsSync(there) && there !== root) there = dirname(there);
	const real = realpathSync(there);
	const realRoot = realpathSync(root);
	if (real !== realRoot && !real.startsWith(realRoot + sep)) throw new Refused(`${asked} leads outside the deck through a link. File calls reach the deck only.`);
	return full;
}

const pathOf = (root: string, full: string) => relative(root, full).split(sep).join("/");

function entryOf(root: string, full: string): DeckFile {
	const stat = statSync(full);
	return { path: pathOf(root, full), size: stat.isDirectory() ? 0 : stat.size, at: Math.round(stat.mtimeMs), ...(stat.isDirectory() ? { dir: true as const } : {}) };
}

/** Every entry under a folder, folders first within each folder, hidden ones and dependencies left out. */
function* walk(root: string, dir: string, deep: boolean): Generator<DeckFile> {
	let names: string[];
	try {
		names = readdirSync(dir).sort();
	} catch {
		return;
	}
	for (const name of names) {
		if (name.startsWith(".")) continue;
		const full = join(dir, name);
		let link;
		try {
			link = lstatSync(full);
		} catch {
			continue;
		}
		// A link is listed as what it points at when that is in the deck, and never walked into.
		if (link.isSymbolicLink()) {
			try {
				resolveIn(root, pathOf(root, full));
				yield entryOf(root, full);
			} catch {}
			continue;
		}
		const entry = entryOf(root, full);
		yield entry;
		if (deep && entry.dir && !SKIPPED.has(name)) yield* walk(root, full, deep);
	}
}

export function listFiles(root: string, path: unknown, options: { deep?: boolean; limit?: number } = {}): DeckFile[] {
	const dir = resolveIn(root, path ?? "");
	if (!existsSync(dir)) throw new Refused(`There is no folder ${path}.`);
	if (!statSync(dir).isDirectory()) return [entryOf(root, dir)];
	const out: DeckFile[] = [];
	const most = capped(options.limit, options.deep ? 1000 : 2000);
	for (const entry of walk(root, dir, options.deep === true)) {
		out.push(entry);
		if (out.length >= most) break;
	}
	return out;
}

export function findFiles(root: string, glob: unknown, options: { path?: string; limit?: number } = {}): DeckFile[] {
	if (typeof glob !== "string" || !glob.trim()) throw new Refused('A pattern to find, as in "*.md" or "canvases/*/cards/*/index.html".');
	const dir = resolveIn(root, options.path ?? "");
	const under = pathOf(root, dir);
	const matches = globMatcher(glob.trim(), under);
	const out: DeckFile[] = [];
	const most = capped(options.limit);
	for (const entry of walk(root, dir, true)) {
		if (entry.dir || !matches(entry.path)) continue;
		out.push(entry);
		if (out.length >= most) break;
	}
	return out;
}

/** A file's bytes as text, or a refusal for what is not text. */
function textOf(root: string, full: string, asked: unknown): { text: string; stat: DeckFile } {
	if (!existsSync(full)) throw new Refused(`There is no file ${asked}.`);
	const stat = entryOf(root, full);
	if (stat.dir) throw new Refused(`${asked} is a folder: decks file list reads it.`);
	if (stat.size > MAX_READ) throw new Refused(`${asked} is ${Math.round(stat.size / 1024)} KB, more than a read takes (${MAX_READ / 1024} KB).`);
	const bytes = readFileSync(full);
	if (!isText(bytes)) throw new Refused(`${asked} is not text. A picture, a film or a PDF is shown by its address: decks file url ${asked}.`);
	return { text: bytes.toString("utf8"), stat };
}

export interface FileText extends DeckFile, TextSlice {}

export function readFile(root: string, path: unknown, options: { from?: number; lines?: number } = {}): FileText {
	const { text, stat } = textOf(root, resolveIn(root, path), path);
	return { ...stat, ...sliceLines(text, options) };
}

/** Refuse a write over a file that changed since the caller read it (`rev` is the `at` a read answered). */
function checkRev(root: string, full: string, asked: unknown, rev: unknown): void {
	if (typeof rev !== "number") return;
	const now = existsSync(full) ? entryOf(root, full).at : 0;
	if (now !== rev) throw new Refused(`${asked} has changed since you read it (it is at ${now}, you had ${rev}). Read it again, then write.`);
}

export function writeFile(root: string, path: unknown, text: unknown, options: { rev?: number } = {}): DeckFile {
	if (typeof text !== "string") throw new Refused("The file's whole text, as a string.");
	if (Buffer.byteLength(text) > MAX_WRITE) throw new Refused(`That is more than a write takes (${MAX_WRITE / 1024 / 1024} MB).`);
	const full = resolveIn(root, path, { write: true });
	if (existsSync(full) && statSync(full).isDirectory()) throw new Refused(`${path} is a folder.`);
	checkRev(root, full, path, options.rev);
	mkdirSync(dirname(full), { recursive: true });
	// In place, never a rename: the canvas watches the file itself.
	writeFileSync(full, text);
	return entryOf(root, full);
}

export type { TextEdit };

export function editFile(root: string, path: unknown, edits: readonly TextEdit[], options: { rev?: number } = {}): DeckFile {
	const full = resolveIn(root, path, { write: true });
	const { text } = textOf(root, full, path);
	checkRev(root, full, path, options.rev);
	writeFileSync(full, applyEdits(String(path), text, edits));
	return entryOf(root, full);
}

export type FileMatch = TextMatch;

export function grepFiles(root: string, pattern: unknown, options: { path?: string; glob?: string; limit?: number; ignoreCase?: boolean } = {}): FileMatch[] {
	const regex = searchPattern(pattern, options);
	const dir = resolveIn(root, options.path ?? "");
	if (!existsSync(dir)) throw new Refused(`There is no ${options.path}.`);
	const under = statSync(dir).isDirectory() ? pathOf(root, dir) : "";
	const wanted = options.glob ? globMatcher(options.glob, under) : () => true;
	const entries = statSync(dir).isDirectory() ? walk(root, dir, true) : [entryOf(root, dir)];
	const out: FileMatch[] = [];
	const most = capped(options.limit);
	for (const entry of entries) {
		if (entry.dir || entry.size > MAX_READ || !wanted(entry.path)) continue;
		// The deck's copy of the libraries is not its content.
		if (entry.path.startsWith("lib/")) continue;
		let bytes: Buffer;
		try {
			bytes = readFileSync(join(root, entry.path));
		} catch {
			continue;
		}
		if (!isText(bytes)) continue;
		if (matchLines(entry.path, bytes.toString("utf8"), regex, out, most)) return out;
	}
	return out;
}

export function moveFile(root: string, path: unknown, to: unknown): DeckFile {
	const from = resolveIn(root, path, { write: true });
	const target = resolveIn(root, to, { write: true });
	if (!existsSync(from)) throw new Refused(`There is no ${path}.`);
	if (existsSync(target)) throw new Refused(`${to} is already there. Delete it first, or choose another name.`);
	if (target.startsWith(from + sep)) throw new Refused(`${to} is inside ${path}.`);
	mkdirSync(dirname(target), { recursive: true });
	renameSync(from, target);
	return entryOf(root, target);
}

/** Delete by moving to the deck's trash (`.decks/trash/files/<time>/<path>`), where it can be moved back by hand. */
export function deleteFile(root: string, path: unknown, now: number = Date.now()): { deleted: string; trash: string } {
	const full = resolveIn(root, path, { write: true });
	if (!existsSync(full)) throw new Refused(`There is no ${path}.`);
	const kept = join(".decks", "trash", "files", new Date(now).toISOString().replace(/[:.]/g, "-"), pathOf(root, full));
	mkdirSync(dirname(join(root, kept)), { recursive: true });
	renameSync(full, join(root, kept));
	return { deleted: pathOf(root, full), trash: kept.split(sep).join("/") };
}
