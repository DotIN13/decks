// The story's strays (rule 1's condition, from Reader's sweep): a doc comment sits right above its item,
// a cluster heading has something under it, and a comment names only paths that exist in the repo.
// Code files of the new folders; generated and copied-in files and the browser check scripts are skipped.

const FOLDERS = ["server", "harness", "protocol", "clients", "tools", "engine", "canvas", "pen", "ui"];
const CODE = /\.(ts|tsx|mjs|js|rs)$/;
const SKIP = /(^|\/)(node_modules|dist|dist-gen|lib|pkg|target|fixtures|baseline)\/|^tools\/checks\/[^/]+\/|\.d\.ts$/;
/** A deck's own path names a file in a deck, not in the repo. */
const DECK_PATH = /^(canvases|cards|assets|docs|apps|files|frames|shared|exports|lib)\//;

export default {
	name: "strays",
	rule: "1. Each file is a story: a doc comment sits on its item, a heading has something under it, a path named exists.",
	scan(ctx) {
		const counts = new Map();
		const known = new Set(ctx.files);
		const tails = new Set(ctx.files.flatMap((f) => f.split("/").map((_, i, parts) => parts.slice(i).join("/"))));
		for (const file of ctx.files.filter((f) => FOLDERS.some((d) => f.startsWith(`${d}/`)) && CODE.test(f) && !SKIP.test(f))) {
			for (const kind of strays(file, ctx.read(file).split("\n"), known, tails)) counts.set(`${file}: ${kind}`, (counts.get(`${file}: ${kind}`) ?? 0) + 1);
		}
		return { counts, notes: ["Keys carry no line number: a stray moved with its file stays the same key."] };
	},
};

/** Each stray in one file, by kind. */
export function strays(file, lines, known, tails) {
	const rust = file.endsWith(".rs");
	return [...strandedDocs(lines, rust), ...emptyHeadings(lines), ...missingPaths(file, lines, known, tails)];
}

// A doc comment cut off from its item, and a heading with nothing under it.

/** A doc comment not directly above an item: followed by a blank line or by another doc. One in the file's head is the file's own. */
function strandedDocs(lines, rust) {
	const out = [];
	const header = headerEnd(lines);
	for (let i = 0; i < lines.length; i++) {
		const t = lines[i].trim();
		let end;
		if (rust) {
			if (!t.startsWith("///") || lines[i - 1]?.trim().startsWith("///")) continue;
			end = i;
			while (lines[end + 1]?.trim().startsWith("///")) end++;
		} else {
			if (!t.startsWith("/**")) continue;
			end = i;
			while (end < lines.length && !lines[end].includes("*/")) end++;
		}
		const next = (lines[end + 1] ?? "").trim();
		if (i >= header) {
			if (next === "") out.push("doc above a blank line");
			else if (next.startsWith("/**") || (rust && next.startsWith("//!"))) out.push("doc above another doc");
		}
		i = end;
	}
	return out;
}

/**
 * A lone // line after a blank line (or first inside a class, impl or interface) whose next line with
 * words is another such heading, a closing bracket, or the end of the file.
 */
function emptyHeadings(lines) {
	const out = [];
	const isLine = (s) => s.startsWith("//") && !s.startsWith("///") && !s.startsWith("//!") && !s.startsWith("// @ts") && !s.startsWith("//#");
	const heading = (k) => {
		const t = lines[k]?.trim() ?? "";
		const before = (lines[k - 1] ?? "").trim();
		const opensType = before.endsWith("{") && /\b(class|impl|interface|trait|mod|enum)\b/.test(before);
		return isLine(t) && (before === "" || opensType) && !isLine((lines[k + 1] ?? "").trim());
	};
	for (let i = firstCodeLine(lines); i < lines.length; i++) {
		if (!heading(i)) continue;
		let j = i + 1;
		while (j < lines.length && lines[j].trim() === "") j++;
		const next = lines[j]?.trim();
		if (next === undefined || /^[}\])]/.test(next) || heading(j)) out.push("heading with nothing under it");
	}
	return out;
}

/** Where the file's head ends: the first line that is not blank, a comment, an import or a re-export. */
function headerEnd(lines) {
	let i = 0;
	let inBlock = false;
	for (; i < lines.length; i++) {
		const t = lines[i].trim();
		if (inBlock) {
			if (t.includes("*/")) inBlock = false;
			continue;
		}
		if (t.startsWith("/*")) {
			inBlock = !t.includes("*/");
			continue;
		}
		if (t === "" || /^(\/\/|#!|import |use |pub use |mod |pub mod |export \* |export \{[^}]*\}( from |;|$)|export type \{|\}?\s*from\s|#!?\[)/.test(t) || /^[\w\s,{}]*\} from /.test(t)) continue;
		break;
	}
	return i;
}

/** Where the code starts: after the opening comment and the imports, so the opening is not taken for a heading. */
function firstCodeLine(lines) {
	let i = 0;
	while (i < lines.length && (lines[i].trim() === "" || /^(\/\/|#!|import |use |export \* |export \{.*\} from )/.test(lines[i].trim()) || /^\s*\}?\s*from\s/.test(lines[i]))) i++;
	return i;
}

// A comment naming a path no file has.

/** Each path with a slash a comment names that no file in the repo has: a file moved, its comment stayed. */
function missingPaths(file, lines, known, tails) {
	const out = [];
	const dir = file.split("/").slice(0, -1).join("/");
	for (const line of lines) {
		const comment = /^\s*(\/\/|\*|\/\*\*)/.test(line) ? line : (line.split(/\s\/\/\s/)[1] ?? "");
		for (const m of comment.matchAll(/(?<![\w@:/.-])((?:\.{1,2}\/)?[\w-]+(?:\/[\w.-]+)+\.(?:ts|tsx|mjs|js|rs|json|css))\b/g)) {
			const path = m[1];
			if (/^https?:|<|\*/.test(path) || DECK_PATH.test(path)) continue;
			if (!known.has(path) && !known.has(normal(`${dir}/${path}`)) && !tails.has(path.replace(/^(\.\.?\/)+/, ""))) out.push("names a path no file has");
		}
	}
	return out;
}

/** A path with . and .. worked out. */
function normal(path) {
	const out = [];
	for (const part of path.split("/")) {
		if (part === "." || part === "") continue;
		if (part === "..") out.pop();
		else out.push(part);
	}
	return out.join("/");
}
