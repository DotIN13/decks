/**
 * A deck's text files, by rule and not by disk: which paths a caller may name, and how a text file is
 * read in part, edited and searched. The file calls of a harness (`file.list`, `file.read`, …) and of
 * a service answer through these, each with its own way of getting at the bytes.
 */

/** A call refused, in a sentence the caller can act on. */
export class Refused extends Error {}

/** The most a read answers, and the largest file a search opens. */
export const MAX_READ = 1024 * 1024;
/** The largest text a write takes. */
export const MAX_WRITE = 5 * 1024 * 1024;
/** How many entries or matches one call answers unless it asks for fewer. */
export const LIMIT = 200;
/** How many it answers at most, whatever it asks for. */
const MOST = 2000;

/** How many entries a call answers: what it asked for up to the most, or `otherwise`. */
export const capped = (limit: unknown, otherwise = LIMIT) => (typeof limit === "number" && limit > 0 ? Math.min(Math.floor(limit), MOST) : otherwise);

// ---- paths -------------------------------------------------------------------------------------

/**
 * A path a caller named, as its parts from the deck's root, or a refusal that says why: never
 * absolute, never upward, never through a hidden folder (`.decks` holds tokens and conversations,
 * `.git` the history). `write` also refuses the root itself and `lib/`, Decks's own copy of its
 * libraries. An empty list is the deck's root.
 */
export function pathParts(asked: unknown, options: { write?: boolean } = {}): string[] {
	if (typeof asked !== "string") throw new Refused('A file is named by its path from the deck\'s root, as in "canvases/plan/cards/q3/index.html".');
	const clean = asked.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
	if (clean.startsWith("/") || /^[a-zA-Z]:/.test(clean)) throw new Refused(`${asked} is an absolute path. File calls reach the deck only: name it from the deck's root.`);
	const parts = clean === "" || clean === "." ? [] : clean.split("/");
	for (const part of parts) {
		if (part === "..") throw new Refused(`${asked} climbs out of the deck. File calls reach the deck only.`);
		if (part === "" || part === ".") throw new Refused(`${asked} is not a path: it has an empty part.`);
		if (part.startsWith(".")) throw new Refused(`${asked} is in a hidden folder (${part}), which file calls do not reach.`);
	}
	if (options.write) {
		if (parts.length === 0) throw new Refused("That is the deck itself, not a file in it.");
		if (parts[0] === "lib") throw new Refused("lib/ is Decks's own copy of its libraries and is not edited: put your file in a card's folder, a canvas's files/ or assets/.");
	}
	return parts;
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

/**
 * Whether a path matches a glob: a pattern with no slash is matched against the file's name,
 * anywhere; one with a slash against the path from `under` (the folder searched), or the whole path.
 */
export function globMatcher(glob: string, under = ""): (path: string) => boolean {
	const pattern = globToRegex(glob);
	const byName = !glob.includes("/");
	return (path) => pattern.test(byName ? path.slice(path.lastIndexOf("/") + 1) : under ? path.slice(under.length + 1) : path);
}

// ---- reading -----------------------------------------------------------------------------------

/** Whether bytes are text: nothing in their first 8,000 is a zero byte. */
export const isText = (bytes: Uint8Array): boolean => !bytes.subarray(0, 8000).includes(0);

/** Part of a text file, as `file.read` answers it. */
export interface TextSlice {
	text: string;
	/** The first line answered, from 1, and how many lines the file has. */
	from: number;
	lines: number;
	/** True when lines after the ones answered were left out. */
	more?: true;
}

/** The lines of a text a read asked for: all of it, or `lines` of them from line `from`. */
export function sliceLines(text: string, options: { from?: number; lines?: number } = {}): TextSlice {
	const all = text.split("\n");
	const from = Math.max(1, Math.floor(typeof options.from === "number" && Number.isFinite(options.from) ? options.from : 1));
	const count = options.lines && options.lines > 0 ? Math.floor(options.lines) : all.length;
	const part = from === 1 && count >= all.length ? text : all.slice(from - 1, from - 1 + count).join("\n");
	return { text: part, from, lines: all.length, ...(from - 1 + count < all.length ? { more: true as const } : {}) };
}

// ---- editing -----------------------------------------------------------------------------------

export interface TextEdit {
	find: string;
	replace: string;
	/** Replace every occurrence; without it `find` must occur exactly once. */
	all?: boolean;
}

const quote = (words: string) => `"${words.length > 60 ? `${words.slice(0, 57)}...` : words}"`;

/** Apply every edit in order, or none: each `find` must be there, and once only unless `all`. */
export function applyEdits(path: string, text: string, edits: readonly TextEdit[]): string {
	if (!Array.isArray(edits) || edits.length === 0) throw new Refused("At least one edit: { find, replace }.");
	let out = text;
	edits.forEach((edit, index) => {
		const label = edits.length > 1 ? `Edit ${index + 1}: ` : "";
		if (typeof edit?.find !== "string" || typeof edit.replace !== "string" || !edit.find) throw new Refused(`${label}an edit is { find, replace }, both strings, find not empty.`);
		const count = out.split(edit.find).length - 1;
		if (count === 0) throw new Refused(`${label}${quote(edit.find)} is not in ${path}. Nothing was changed.`);
		if (count > 1 && !edit.all) throw new Refused(`${label}${quote(edit.find)} is in ${path} ${count} times. Give more of the words around it, or set all. Nothing was changed.`);
		out = edit.all ? out.split(edit.find).join(edit.replace) : out.replace(edit.find, () => edit.replace);
	});
	return out;
}

// ---- searching ---------------------------------------------------------------------------------

export interface TextMatch {
	path: string;
	line: number;
	text: string;
}

/** What a search looks for, or a refusal for a pattern that is no regular expression. */
export function searchPattern(pattern: unknown, options: { ignoreCase?: boolean } = {}): RegExp {
	if (typeof pattern !== "string" || !pattern) throw new Refused("A regular expression to search for.");
	try {
		return new RegExp(pattern, options.ignoreCase ? "i" : "");
	} catch (error) {
		throw new Refused(`${pattern} is not a regular expression: ${(error as Error).message}`);
	}
}

/**
 * The lines of one file that match, added to `out` until it holds `most`: each with its number and
 * its words, a long line cut at 300 characters. Answers whether `out` is full.
 */
export function matchLines(path: string, text: string, pattern: RegExp, out: TextMatch[], most: number): boolean {
	const lines = text.split("\n");
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index]!;
		if (!pattern.test(line)) continue;
		out.push({ path, line: index + 1, text: line.length > 300 ? `${line.slice(0, 300)}…` : line });
		if (out.length >= most) return true;
	}
	return false;
}
