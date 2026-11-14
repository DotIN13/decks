import { Refused, type Caller } from "../../protocol/index.ts";
import type * as S from "./shapes.ts";
import type { Deck, DeckPath, Entry, Revision } from "../kernel/types.ts";
import { parentOf } from "./fence.ts";

// Files read and written through the Deck, as text. Rules 2 to 7 of the README.

export const MAX_READ = 1024 * 1024;
export const LIMIT = 200;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export const fileOf = (entry: Entry): S.File => ({ path: entry.path, size: entry.size, ...(entry.rev === undefined ? {} : { rev: entry.rev }), at: entry.at, ...(entry.kind === "dir" ? { dir: true } : {}) });

/** What is at a path, or undefined. */
export async function stat(deck: Deck, path: DeckPath): Promise<Entry | undefined> {
	try {
		return (await deck.list(parentOf(path))).find((entry) => entry.path === path);
	} catch (error) {
		if (error instanceof Refused && error.code === "not_found") return undefined;
		throw error;
	}
}

/** A text file's words and revision; a folder or bytes that are not UTF-8 are refused. */
export async function readText(deck: Deck, path: DeckPath): Promise<{ text: string; rev: number; truncated: boolean }> {
	const entry = await stat(deck, path);
	if (!entry) throw new Refused("not_found", `There is no file at ${path}.`, "file.list");
	if (entry.kind === "dir") throw new Refused("invalid", `${path} is a folder: file.list reads a folder.`, "file.list");
	const bytes = await deck.read(path);
	const truncated = bytes.length > MAX_READ;
	try {
		return { text: decoder.decode(truncated ? bytes.subarray(0, MAX_READ) : bytes, { stream: truncated }), rev: entry.rev ?? 0, truncated };
	} catch {
		throw new Refused("invalid", `${path} is not text, so it cannot be read as words.`, "file.url");
	}
}

/** Refuse a write made on an older revision than the file has now. */
export async function checkRev(deck: Deck, path: DeckPath, rev: number | undefined): Promise<void> {
	if (rev === undefined) return;
	const now = (await stat(deck, path))?.rev;
	if (now !== rev) throw new Refused("conflict", `${path} is at revision ${now ?? "none"}, not ${rev}: someone wrote it since you read it.`, "file.read");
}

export async function writeText(deck: Deck, path: DeckPath, text: string, by: Caller): Promise<S.File> {
	return answerOf(await deck.write(path, encoder.encode(text), by), encoder.encode(text).length, by);
}

export const answerOf = (rev: Revision, size: number, by: Caller): S.File => ({ path: rev.path, size, rev: rev.rev, by: by.id, at: rev.at });

/** Part of a text: from a 1-based line, so many lines. */
export function slice(text: string, from?: number, lines?: number): { text: string; cut: boolean } {
	if (from === undefined && lines === undefined) return { text, cut: false };
	const all = text.split("\n");
	const start = Math.max(0, (from ?? 1) - 1);
	const end = lines === undefined ? all.length : start + Math.max(0, lines);
	return { text: all.slice(start, end).join("\n"), cut: start > 0 || end < all.length };
}

/** Exact replacements, all or none. Rule 4. */
export function applyEdits(path: string, text: string, edits: readonly S.TextEdit[]): string {
	if (edits.length === 0) throw new Refused("invalid", "No edits were given.", "file.write");
	let out = text;
	edits.forEach((edit, n) => {
		if (!edit.find) throw new Refused("invalid", `Edit ${n + 1} finds nothing: give the exact words to replace.`, "file.write");
		const count = out.split(edit.find).length - 1;
		if (count === 0) throw new Refused("not_found", `Edit ${n + 1}: ${quote(edit.find)} is not in ${path}.`, "file.read");
		if (count > 1 && !edit.all) throw new Refused("conflict", `Edit ${n + 1}: ${quote(edit.find)} is in ${path} ${count} times; give more words, or set all.`, "file.read");
		out = edit.all ? out.split(edit.find).join(edit.replace) : out.replace(edit.find, () => edit.replace);
	});
	return out;
}

const quote = (words: string) => `"${words.length > 60 ? `${words.slice(0, 57)}...` : words}"`;

/** Every entry under a folder, deep; lib/ is skipped unless it is the folder asked for. */
export async function walk(deck: Deck, dir: DeckPath | "", deep: boolean, skipLib = false): Promise<Entry[]> {
	const out: Entry[] = [];
	const visit = async (at: DeckPath | ""): Promise<void> => {
		for (const entry of await deck.list(at)) {
			if (skipLib && entry.path === "lib") continue;
			out.push(entry);
			if (deep && entry.kind === "dir") await visit(entry.path);
		}
	};
	await visit(dir);
	return out;
}

/** A glob as a regular expression: * within a folder, ** across, ? one letter. */
export function globToRegex(glob: string): RegExp {
	let out = "";
	for (let i = 0; i < glob.length; i++) {
		const ch = glob[i]!;
		if (ch === "*" && glob[i + 1] === "*") {
			out += glob[i + 2] === "/" ? "(?:.*/)?" : ".*";
			i += glob[i + 2] === "/" ? 2 : 1;
		} else if (ch === "*") out += "[^/]*";
		else if (ch === "?") out += "[^/]";
		else out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
	}
	return new RegExp(`^${out}$`);
}

/** Whether a path matches a glob: the whole path, or only its name when the glob has no slash. */
export function matchesGlob(glob: RegExp, hasSlash: boolean, path: string, under: string): boolean {
	const rel = under ? path.slice(under.length + 1) : path;
	return glob.test(hasSlash ? rel : (rel.split("/").pop() ?? rel));
}
