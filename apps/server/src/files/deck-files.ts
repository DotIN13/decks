import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

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
 * Pure of the server: every function takes the deck's root. The calls are `verbs/files.ts`.
 */

export class FileRefused extends Error {}

export interface DeckFile {
	path: string;
	size: number;
	/** When it last changed, epoch milliseconds: also its revision, for a write that must not overwrite a newer one. */
	at: number;
	dir?: true;
}

/** The most a read answers, and the largest file a search opens or a write takes. */
export const MAX_READ = 1024 * 1024;
export const MAX_WRITE = 5 * 1024 * 1024;
/** How many entries or matches one call answers unless it asks for fewer. */
export const LIMIT = 200;
/** Folders a walk never enters: dependencies and build output are not the deck's content. */
const SKIPPED = new Set(["node_modules", "dist", "build"]);

/**
 * A path a caller named, as an absolute path inside the deck, or a refusal that says why. `write`
 * also refuses `lib/` and the deck's own root.
 */
export function resolveIn(root: string, asked: unknown, options: { write?: boolean } = {}): string {
	if (typeof asked !== "string") throw new FileRefused('A file is named by its path from the deck\'s root, as in "canvases/plan/cards/q3/index.html".');
	const clean = asked.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
	if (clean.startsWith("/") || /^[a-zA-Z]:/.test(clean)) throw new FileRefused(`${asked} is an absolute path. File calls reach the deck only: name it from the deck's root.`);
	const parts = clean === "" || clean === "." ? [] : clean.split("/");
	for (const part of parts) {
		if (part === "..") throw new FileRefused(`${asked} climbs out of the deck. File calls reach the deck only.`);
		if (part === "" || part === ".") throw new FileRefused(`${asked} is not a path: it has an empty part.`);
		if (part.startsWith(".")) throw new FileRefused(`${asked} is in a hidden folder (${part}), which file calls do not reach.`);
	}
	if (options.write) {
		if (parts.length === 0) throw new FileRefused("That is the deck itself, not a file in it.");
		if (parts[0] === "lib") throw new FileRefused("lib/ is Decks's own copy of its libraries and is not edited: put your file in a card's folder, a canvas's files/ or assets/.");
	}
	const full = join(root, ...parts);
	// A link may point anywhere: what exists of the path must still be inside the deck once links are followed.
	let there = full;
	while (!existsSync(there) && there !== root) there = dirname(there);
	const real = realpathSync(there);
	const realRoot = realpathSync(root);
	if (real !== realRoot && !real.startsWith(realRoot + sep)) throw new FileRefused(`${asked} leads outside the deck through a link. File calls reach the deck only.`);
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

const capped = (limit: unknown, most = LIMIT) => (typeof limit === "number" && limit > 0 ? Math.min(Math.floor(limit), 2000) : most);

export function listFiles(root: string, path: unknown, options: { deep?: boolean; limit?: number } = {}): DeckFile[] {
	const dir = resolveIn(root, path ?? "");
	if (!existsSync(dir)) throw new FileRefused(`There is no folder ${path}.`);
	if (!statSync(dir).isDirectory()) return [entryOf(root, dir)];
	const out: DeckFile[] = [];
	const most = capped(options.limit, options.deep ? 1000 : 2000);
	for (const entry of walk(root, dir, options.deep === true)) {
		out.push(entry);
		if (out.length >= most) break;
	}
	return out;
}

/** A glob as a pattern: `*` within a name, `**` across folders, `?` one character. */
export function globToRegex(glob: string): RegExp {
	let out = "";
	for (let index = 0; index < glob.length; index++) {
		const char = glob[index]!;
		if (char === "*") {
			if (glob[index + 1] === "*") {
				out += ".*";
				index += glob[index + 2] === "/" ? 2 : 1;
			} else out += "[^/]*";
		} else if (char === "?") out += "[^/]";
		else out += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
	}
	return new RegExp(`^${out}$`);
}

/** Whether a path under `under` matches: a pattern with no slash is matched against the file's name, anywhere. */
function matcher(glob: string, under: string): (path: string) => boolean {
	const pattern = globToRegex(glob);
	const byName = !glob.includes("/");
	return (path) => pattern.test(byName ? path.slice(path.lastIndexOf("/") + 1) : under ? path.slice(under.length + 1) : path);
}

export function findFiles(root: string, glob: unknown, options: { path?: string; limit?: number } = {}): DeckFile[] {
	if (typeof glob !== "string" || !glob.trim()) throw new FileRefused('A pattern to find, as in "*.md" or "canvases/*/cards/*/index.html".');
	const dir = resolveIn(root, options.path ?? "");
	const under = pathOf(root, dir);
	const matches = matcher(glob.trim(), under);
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
	if (!existsSync(full)) throw new FileRefused(`There is no file ${asked}.`);
	const stat = entryOf(root, full);
	if (stat.dir) throw new FileRefused(`${asked} is a folder: decks file list reads it.`);
	if (stat.size > MAX_READ) throw new FileRefused(`${asked} is ${Math.round(stat.size / 1024)} KB, more than a read takes (${MAX_READ / 1024} KB).`);
	const bytes = readFileSync(full);
	if (bytes.subarray(0, 8000).includes(0)) throw new FileRefused(`${asked} is not text. A picture, a film or a PDF is shown by its address: decks file url ${asked}.`);
	return { text: bytes.toString("utf8"), stat };
}

export interface FileText extends DeckFile {
	text: string;
	/** The first line answered, from 1, and how many lines the file has. */
	from: number;
	lines: number;
	/** True when lines after the ones answered were left out. */
	more?: true;
}

export function readFile(root: string, path: unknown, options: { from?: number; lines?: number } = {}): FileText {
	const { text, stat } = textOf(root, resolveIn(root, path), path);
	const all = text.split("\n");
	const from = Math.max(1, Math.floor(options.from ?? 1));
	const count = options.lines && options.lines > 0 ? Math.floor(options.lines) : all.length;
	const part = from === 1 && count >= all.length ? text : all.slice(from - 1, from - 1 + count).join("\n");
	return { ...stat, text: part, from, lines: all.length, ...(from - 1 + count < all.length ? { more: true as const } : {}) };
}

/** Refuse a write over a file that changed since the caller read it (`rev` is the `at` a read answered). */
function checkRev(root: string, full: string, asked: unknown, rev: unknown): void {
	if (typeof rev !== "number") return;
	const now = existsSync(full) ? entryOf(root, full).at : 0;
	if (now !== rev) throw new FileRefused(`${asked} has changed since you read it (it is at ${now}, you had ${rev}). Read it again, then write.`);
}

export function writeFile(root: string, path: unknown, text: unknown, options: { rev?: number } = {}): DeckFile {
	if (typeof text !== "string") throw new FileRefused("The file's whole text, as a string.");
	if (Buffer.byteLength(text) > MAX_WRITE) throw new FileRefused(`That is more than a write takes (${MAX_WRITE / 1024 / 1024} MB).`);
	const full = resolveIn(root, path, { write: true });
	if (existsSync(full) && statSync(full).isDirectory()) throw new FileRefused(`${path} is a folder.`);
	checkRev(root, full, path, options.rev);
	mkdirSync(dirname(full), { recursive: true });
	// In place, never a rename: the canvas watches the file itself.
	writeFileSync(full, text);
	return entryOf(root, full);
}

export interface TextEdit {
	find: string;
	replace: string;
	/** Replace every occurrence; without it `find` must occur exactly once. */
	all?: boolean;
}

/** Apply every edit in order, or none: each `find` must be there, and once only unless `all`. */
export function applyEdits(path: string, text: string, edits: readonly TextEdit[]): string {
	if (!Array.isArray(edits) || edits.length === 0) throw new FileRefused("At least one edit: { find, replace }.");
	let out = text;
	edits.forEach((edit, index) => {
		const label = edits.length > 1 ? `Edit ${index + 1}: ` : "";
		if (typeof edit?.find !== "string" || typeof edit.replace !== "string" || !edit.find) throw new FileRefused(`${label}an edit is { find, replace }, both strings, find not empty.`);
		const count = out.split(edit.find).length - 1;
		if (count === 0) throw new FileRefused(`${label}${quote(edit.find)} is not in ${path}. Nothing was changed.`);
		if (count > 1 && !edit.all) throw new FileRefused(`${label}${quote(edit.find)} is in ${path} ${count} times. Give more of the words around it, or set all. Nothing was changed.`);
		out = edit.all ? out.split(edit.find).join(edit.replace) : out.replace(edit.find, () => edit.replace);
	});
	return out;
}
const quote = (words: string) => `"${words.length > 60 ? `${words.slice(0, 57)}...` : words}"`;

export function editFile(root: string, path: unknown, edits: readonly TextEdit[], options: { rev?: number } = {}): DeckFile {
	const full = resolveIn(root, path, { write: true });
	const { text } = textOf(root, full, path);
	checkRev(root, full, path, options.rev);
	writeFileSync(full, applyEdits(String(path), text, edits));
	return entryOf(root, full);
}

export interface FileMatch {
	path: string;
	line: number;
	text: string;
}

export function grepFiles(root: string, pattern: unknown, options: { path?: string; glob?: string; limit?: number; ignoreCase?: boolean } = {}): FileMatch[] {
	if (typeof pattern !== "string" || !pattern) throw new FileRefused("A regular expression to search for.");
	let regex: RegExp;
	try {
		regex = new RegExp(pattern, options.ignoreCase ? "i" : "");
	} catch (error) {
		throw new FileRefused(`${pattern} is not a regular expression: ${(error as Error).message}`);
	}
	const dir = resolveIn(root, options.path ?? "");
	if (!existsSync(dir)) throw new FileRefused(`There is no ${options.path}.`);
	const under = statSync(dir).isDirectory() ? pathOf(root, dir) : "";
	const wanted = options.glob ? matcher(options.glob, under) : () => true;
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
		if (bytes.subarray(0, 8000).includes(0)) continue;
		const lines = bytes.toString("utf8").split("\n");
		for (let index = 0; index < lines.length; index++) {
			if (!regex.test(lines[index]!)) continue;
			out.push({ path: entry.path, line: index + 1, text: lines[index]!.length > 300 ? `${lines[index]!.slice(0, 300)}…` : lines[index]! });
			if (out.length >= most) return out;
		}
	}
	return out;
}

export function moveFile(root: string, path: unknown, to: unknown): DeckFile {
	const from = resolveIn(root, path, { write: true });
	const target = resolveIn(root, to, { write: true });
	if (!existsSync(from)) throw new FileRefused(`There is no ${path}.`);
	if (existsSync(target)) throw new FileRefused(`${to} is already there. Delete it first, or choose another name.`);
	if (target.startsWith(from + sep)) throw new FileRefused(`${to} is inside ${path}.`);
	mkdirSync(dirname(target), { recursive: true });
	renameSync(from, target);
	return entryOf(root, target);
}

/** Delete by moving to the deck's trash (`.decks/trash/files/<time>/<path>`), where it can be moved back by hand. */
export function deleteFile(root: string, path: unknown, now: number = Date.now()): { deleted: string; trash: string } {
	const full = resolveIn(root, path, { write: true });
	if (!existsSync(full)) throw new FileRefused(`There is no ${path}.`);
	const kept = join(".decks", "trash", "files", new Date(now).toISOString().replace(/[:.]/g, "-"), pathOf(root, full));
	mkdirSync(dirname(join(root, kept)), { recursive: true });
	renameSync(full, join(root, kept));
	return { deleted: pathOf(root, full), trash: kept.split(sep).join("/") };
}
