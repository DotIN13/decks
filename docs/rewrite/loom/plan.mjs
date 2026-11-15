// Plans one move of the canvas libraries: which files go where, and every line that changes for it.
// Pure: it reads through repo.read and writes nothing. move.mjs prints the plan or applies it.
import { posix } from "node:path";

const { dirname, join, normalize, relative } = posix;

/** Files whose import paths and package names are rewritten. */
export const SCANNED = /\.(ts|tsx|mts|cts|mjs|cjs|js|jsx|css|json)$/;
/** Files only searched for old paths left behind, never rewritten. */
export const MENTIONS = /\.(ts|tsx|mts|cts|mjs|cjs|js|jsx|css|json|md|sh|html|swift|toml|yml|yaml)$/;
const NEVER = /(^|\/)(node_modules|dist|dist-gen|target|\.scratch)\/|package-lock\.json$|^tools\/gates\/baseline\/|^docs\/rewrite\/loom\//;
const TRIES = [".ts", ".tsx", ".mts", ".mjs", ".js", ".d.ts"];
const INDEXES = ["/index.ts", "/index.tsx", "/index.mjs", "/index.js"];

/** Old path to new path. A folder entry ends with "/"; the longest folder that holds a path wins. */
export function mapper(moves) {
	const folders = moves.filter((m) => m.from.endsWith("/")).sort((a, b) => b.from.length - a.from.length);
	const files = new Map(moves.filter((m) => !m.from.endsWith("/")).map((m) => [m.from, m.to]));
	return (p) => {
		if (files.has(p)) return files.get(p);
		for (const ext of TRIES) {
			const to = files.get(p + ext);
			if (to?.endsWith(ext)) return to.slice(0, -ext.length);
		}
		for (const f of folders) {
			if (p === f.from.slice(0, -1)) return f.to.slice(0, -1);
			if (p.startsWith(f.from)) return f.to + p.slice(f.from.length);
		}
		return p;
	};
}

/** The git renames, refusing two files on one place or a move onto a file that stays. */
export function renames(files, map, untracked) {
	const out = [];
	const seen = new Map();
	for (const f of files) {
		const to = map(f);
		if (to === f || untracked.has(f)) continue;
		if (seen.has(to)) throw new Error(`${f} and ${seen.get(to)} would both move to ${to}`);
		seen.set(to, f);
		out.push([f, to]);
	}
	const moving = new Set(out.map(([f]) => f));
	const staying = new Set(files.filter((f) => !moving.has(f)));
	for (const [f, to] of out) if (staying.has(to)) throw new Error(`${f} would move onto ${to}, which stays`);
	return out;
}

/** Whether a path names a file or a folder of the set, as a module resolver would find it. */
export function resolves(target, files, dirs) {
	if (files.has(target) || dirs.has(target)) return true;
	return [...TRIES, ...INDEXES].some((ext) => files.has(target + ext));
}

function dirsOf(files) {
	const out = new Set();
	for (const f of files) for (let d = dirname(f); d !== "." && !out.has(d); d = dirname(d)) out.add(d);
	return out;
}

/** A relative path from one file to a target, written as an import would write it. */
function relativeFrom(file, target, slash) {
	let rel = relative(dirname(file), target) || ".";
	if (!rel.startsWith(".")) rel = `./${rel}`;
	return slash && !rel.endsWith("/") ? `${rel}/` : rel;
}

/** One relative path, rewritten when the file or its target moves; unchanged when it still lands right. */
function rewriteRelative(spec, ctx) {
	const oldTarget = normalize(join(dirname(ctx.from), spec));
	const newTarget = ctx.map(oldTarget);
	if (normalize(join(dirname(ctx.to), spec)) === newTarget) return spec;
	if (resolves(oldTarget, ctx.oldFiles, ctx.oldDirs) && !resolves(newTarget, ctx.newFiles, ctx.newDirs)) {
		ctx.warnings.push(`${ctx.to}: ${spec} points at ${newTarget}, which is not in the tree after the move`);
	}
	return relativeFrom(ctx.to, newTarget, spec.endsWith("/"));
}

const CODE_PATH = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|@import\s+(?:url\(\s*)?)(["'])(\.\.?\/[^"'\n]*)\2/g;
/** Only a URL made from this module's own address is a path in the tree; one from a card's address is not. */
const MODULE_URL = /(\bnew\s+URL\s*\(\s*)(["'])(\.\.?\/[^"'\n]*)\2(?=\s*,\s*import\.meta\.url)/g;
const JSON_PATH = /((?:^|[:[,])\s*)"(\.\.?\/[^"\n]*)"(?!\s*:)/g;

function bareRule(specifiers) {
	const names = Object.keys(specifiers || {});
	if (!names.length) return null;
	const alt = names.map((n) => n.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join("|");
	return new RegExp(`(["'\`])(${alt})((?:/[^"'\`\\n]*)?)\\1`, "g");
}

/** One line of one file, with its import paths and package names rewritten. */
function rewriteLine(line, ctx, inScripts) {
	let out = line;
	if (ctx.from.endsWith(".json")) {
		if (!inScripts) out = out.replace(JSON_PATH, (_m, head, spec) => `${head}"${rewriteRelative(spec, ctx)}"`);
	} else {
		const fix = (_m, head, q, spec) => `${head}${q}${rewriteRelative(spec, ctx)}${q}`;
		out = out.replace(CODE_PATH, fix).replace(MODULE_URL, fix);
	}
	if (ctx.bare) out = out.replace(ctx.bare, (_m, q, name, sub) => `${q}${ctx.specifiers[name]}${sub}${q}`);
	for (const [from, to] of ctx.mentions) out = out.split(from).join(to);
	return out;
}

/** A whole file, line by line, noting each line that changed. */
export function rewriteFile(text, ctx) {
	const lines = text.split("\n");
	let inScripts = false;
	const changes = [];
	const out = lines.map((line, i) => {
		const opens = ctx.from.endsWith("package.json") && /"scripts"\s*:\s*\{/.test(line);
		if (opens) inScripts = true;
		const next = rewriteLine(line, ctx, inScripts);
		if (inScripts && line.includes("}")) inScripts = false;
		if (next !== line) changes.push({ file: ctx.to, line: i + 1, before: line, after: next });
		return next;
	});
	return { text: out.join("\n"), changes };
}

const skipped = (f, table) => NEVER.test(f) || (table.skip || []).some((p) => f.startsWith(p));

/** Literal replacements a table names in one file, each checked to match as often as it says. */
function replacePaths(text, file, entries) {
	if (text == null) throw new Error(`${file}: not in the tree after the move`);
	let out = text;
	for (const e of entries) {
		const found = out.split(e.from).length - 1;
		if (found !== (e.count ?? 1)) throw new Error(`${file}: "${e.from}" found ${found} times, expected ${e.count ?? 1}`);
		out = out.split(e.from).join(e.to);
	}
	return out;
}

/** Top-level values of a JSON file set or removed (null removes), written back in the file's own indent. */
export function setJson(text, values, file = "a JSON file") {
	if (text == null) throw new Error(`${file}: not in the tree after the move`);
	const indent = /^\{\n(\t| +)/.exec(text)?.[1] ?? "\t";
	const obj = JSON.parse(text);
	for (const [k, v] of Object.entries(values)) {
		if (v === null) delete obj[k];
		else obj[k] = v;
	}
	return `${JSON.stringify(obj, null, indent)}\n`;
}

function setWorkspaces(text, ws) {
	const obj = JSON.parse(text);
	const list = (obj.workspaces || []).filter((w) => !(ws.remove || []).includes(w));
	for (const w of ws.add || []) if (!list.includes(w)) list.push(w);
	return setJson(text, { workspaces: list });
}

function addLines(text, lines) {
	const have = new Set(text.split("\n"));
	const missing = lines.filter((l) => !have.has(l));
	if (!missing.length) return text;
	return `${text}${text.endsWith("\n") || !text ? "" : "\n"}${missing.join("\n")}\n`;
}

/** The table's own edits after the rewrite: paths, JSON values, workspaces, ignore lines, new files. */
function tableEdits(table, current, write) {
	for (const p of table.paths || []) write(p.file, replacePaths(current(p.file), p.file, p.replace));
	for (const s of table.set || []) write(s.file, setJson(current(s.file), s.values, s.file));
	if (table.workspaces) write("package.json", setWorkspaces(current("package.json"), table.workspaces));
	for (const g of table.ignore || []) write(g.file, addLines(current(g.file) ?? "", g.add));
	for (const c of table.create || []) write(c.file, c.text);
}

/** Where each old path is still written after the move, by file, for a person to read. */
function leftovers(table, files, current) {
	const olds = [...new Set(table.moves.filter((m) => m.from.endsWith("/")).map((m) => m.from.split("/").slice(0, 2).join("/")))];
	const out = [];
	for (const f of files) {
		if (!MENTIONS.test(f) || skipped(f, table)) continue;
		const text = current(f);
		if (text == null) continue;
		const n = olds.reduce((sum, o) => sum + (text.split(o).length - 1), 0);
		if (n) out.push({ file: f, count: n });
	}
	return out;
}

/** The whole plan for one table over one repo ({ files, read }). */
export function plan(table, repo) {
	const map = mapper(table.moves);
	const untracked = new Set(repo.files.filter((f) => (table.untrack || []).some((p) => f.startsWith(p))));
	const moves = renames(repo.files, map, untracked);
	const newOf = new Map(moves);
	const newPaths = repo.files.filter((f) => !untracked.has(f)).map((f) => newOf.get(f) ?? f);
	const oldFiles = new Set(repo.files);
	const newFiles = new Set(newPaths);
	const base = { map, oldFiles, newFiles, oldDirs: dirsOf(oldFiles), newDirs: dirsOf(newFiles), warnings: [], specifiers: table.specifiers || {}, bare: bareRule(table.specifiers), mentions: table.mentions || [] };
	const texts = new Map();
	const edits = new Map();
	const changes = [];
	for (const f of repo.files) {
		if (untracked.has(f)) continue;
		const to = newOf.get(f) ?? f;
		const text = MENTIONS.test(f) ? repo.read(f) : null;
		if (text != null) texts.set(to, text);
		if (text == null || !SCANNED.test(f) || skipped(f, table)) continue;
		const r = rewriteFile(text, { ...base, from: f, to });
		if (r.text !== text) { edits.set(to, r.text); changes.push(...r.changes); }
	}
	const oldOf = new Map(moves.map(([a, b]) => [b, a]));
	const current = (f) => {
		if (edits.has(f)) return edits.get(f);
		if (!texts.has(f) && newFiles.has(f)) texts.set(f, repo.read(oldOf.get(f) ?? f));
		return texts.get(f);
	};
	const write = (f, text) => { if (text !== texts.get(f)) edits.set(f, text); else edits.delete(f); };
	tableEdits(table, current, write);
	return { moves, untrack: [...untracked], edits, changes, warnings: base.warnings, leftovers: leftovers(table, [...newFiles], current) };
}
