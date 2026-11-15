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
	if (resolves(oldTarget, ctx.oldFiles, ctx.oldDirs) && !resolves(newTarget, ctx.onDisk, ctx.newDirs)) {
		ctx.warnings.push(`${ctx.to}: ${spec} points at ${newTarget}, which is not in the tree after the move`);
	}
	if (normalize(join(dirname(ctx.to), spec)) === newTarget) return spec;
	return relativeFrom(ctx.to, newTarget, spec.endsWith("/"));
}

/** An import or export statement's line: the only lines whose paths and names change by themselves. */
const IMPORT_LINE = /^\s*(import\b|export\b[^=]*\bfrom\b|\}\s*from\b|@import\b)/;
const STATIC_PATH = /(\bfrom\s*|^\s*import\s+|@import\s+(?:url\(\s*)?)(["'])(\.\.?\/[^"'\n]*)\2/g;
/** A call that loads a module: import() or require(), wherever it is. */
const CALL_PATH = /(\bimport\s*\(\s*|\brequire\s*\(\s*)(["'])(\.\.?\/[^"'\n]*)\2/g;
const JSON_PATH = /((?:^|[:[,])\s*)"(\.\.?\/[^"\n]*)"(?!\s*:)/g;
/** Any other relative path in a string: never rewritten by itself, only warned about when it points into a move. */
const OTHER_PATH = /(["'`])(\.\.?\/[^"'`\n]*)\1/g;
/** The config files whose relative values are paths: a package's and a type check's. */
const CONFIG = /(^|\/)(package\.json|tsconfig[\w.-]*\.json)$/;

/** A name npm can install: "name" or "@scope/name", with no subpath. A dependency key must be one. */
const isPackageName = (name) => /^(@[^/]+\/)?[^/@]+$/.test(name);

function bareRule(specifiers) {
	const names = Object.keys(specifiers || {});
	if (!names.length) return null;
	const alt = names.map((n) => n.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join("|");
	return new RegExp(`(["'\`])(${alt})((?:/[^"'\`\\n]*)?)\\1`, "g");
}

/** Where a line's comment starts, outside any string; -1 when it has none. A whole comment line starts at 0. */
export function commentStart(line) {
	if (/^\s*(\/\/|\/\*|\*)/.test(line)) return 0;
	let quote = "";
	for (let i = 0; i < line.length - 1; i++) {
		const ch = line[i];
		if (quote) { if (ch === "\\") i++; else if (ch === quote) quote = ""; continue; }
		if (ch === '"' || ch === "'" || ch === "`") quote = ch;
		else if (ch === "/" && (line[i + 1] === "/" || line[i + 1] === "*")) return i;
	}
	return -1;
}

/** A package name in a package.json dependency key, or in an import line or a load call of code. */
function renameBare(line, ctx, isImport) {
	if (!ctx.bare) return line;
	const to = (m, q, name, sub) => `${q}${ctx.specifiers[name]}${sub}${q}`;
	if (ctx.from.endsWith("package.json")) return line.replace(ctx.bare, (m, q, name, sub) => (isPackageName(ctx.specifiers[name]) && /^\s*"[^"]+"\s*:/.test(line) ? to(m, q, name, sub) : m));
	if (isImport) return line.replace(ctx.bare, to);
	return line.replace(/(\bimport\s*\(\s*|\brequire\s*\(\s*)(["'])([^"']+)\2/g, (m, head, q, spec) => {
		const name = Object.keys(ctx.specifiers).find((n) => spec === n || spec.startsWith(`${n}/`));
		return name ? `${head}${q}${ctx.specifiers[name]}${spec.slice(name.length)}${q}` : m;
	});
}

/** A relative string the move does not rewrite that points into it: the table must list it. */
function warnOther(line, ctx, n) {
	for (const m of line.matchAll(OTHER_PATH)) {
		const target = normalize(join(dirname(ctx.from), m[2]));
		if (ctx.map(target) !== target || ctx.from !== ctx.to) {
			const fresh = normalize(join(dirname(ctx.to), m[2]));
			const listed = (ctx.listed.get(ctx.to) ?? []).some((from) => from.includes(m[2])) || ctx.kept.has(`${ctx.to}|${m[2]}`);
			if (fresh !== ctx.map(target) && !listed) ctx.warnings.push(`${ctx.to}:${n}: the string ${m[2]} points at a moved path and is not rewritten; list it in paths`);
		}
	}
}

/** One line of one file: its import paths, its package names, and the comments' mentions. */
function rewriteLine(line, ctx, inScripts, n) {
	const fix = (_m, head, q, spec) => `${head}${q}${rewriteRelative(spec, ctx)}${q}`;
	let out = line;
	if (ctx.from.endsWith(".json")) {
		if (CONFIG.test(ctx.from) && !inScripts) out = out.replace(JSON_PATH, (_m, head, spec) => `${head}"${rewriteRelative(spec, ctx)}"`);
		return renameBare(out, ctx, false);
	}
	const at = commentStart(line);
	const code = at < 0 ? line : line.slice(0, at);
	let rest = at < 0 ? "" : line.slice(at);
	const isImport = at !== 0 && IMPORT_LINE.test(code);
	let head = code;
	if (isImport) {
		head = head.replace(STATIC_PATH, fix);
		for (const l of ctx.localize) head = head.replace(l.rule, (_m, q) => `${q}${relativeFrom(ctx.to, l.target, false)}${q}`);
	}
	head = head.replace(CALL_PATH, fix);
	head = renameBare(head, ctx, isImport);
	if (!isImport && head === code) warnOther(code.replace(CALL_PATH, ""), ctx, n);
	for (const [from, to, within] of ctx.mentions) if (!within || ctx.to.startsWith(within)) rest = rest.split(from).join(to);
	out = head + rest;
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
		const next = rewriteLine(line, ctx, inScripts, i + 1);
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

/** Values of a JSON file set or removed (null removes), written back in the file's own indent.
 * A key with dots reaches inside ("dependencies.@decks/ink"); a key that is a JSON list is the path
 * itself, for names with dots ('["exports","./ink"]'). */
export function setJson(text, values, file = "a JSON file") {
	if (text == null) throw new Error(`${file}: not in the tree after the move`);
	const indent = /^\{\n(\t| +)/.exec(text)?.[1] ?? "\t";
	const obj = JSON.parse(text);
	for (const [key, v] of Object.entries(values)) {
		const path = key.startsWith("[") ? JSON.parse(key) : key.split(".");
		const last = path.pop();
		let at = obj;
		for (const k of path) at = at[k] ??= {};
		if (v === null) delete at[last];
		else at[last] = v;
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

/** Where each old path is still written after the move, by file: in code lines (to list or keep) and elsewhere. */
function leftovers(table, files, current) {
	const units = [...new Set(table.moves.filter((m) => m.from.endsWith("/")).map((m) => m.from.split("/").slice(0, 2).join("/")))];
	// A path joined from its parts names the folder too: join(root, "packages", "stage").
	const olds = units.flatMap((u) => (u.startsWith("packages/") ? [u, u.split("/").map((part) => `"${part}"`).join(", ")] : [u]));
	const kept = new Set((table.keep || []).map((k) => `${k.file}|${k.string}`));
	const out = [];
	const code = [];
	for (const f of files) {
		if (!MENTIONS.test(f) || skipped(f, table)) continue;
		const text = current(f);
		if (text == null) continue;
		text.split("\n").forEach((line, i) => {
			const n = olds.reduce((sum, o) => sum + (line.split(o).length - 1), 0);
			if (!n) return;
			const inCode = SCANNED.test(f) && !f.endsWith(".json") ? commentStart(line) !== 0 : false;
			if (inCode && !(table.keep || []).some((k) => k.file === f && line.includes(k.string)) && !kept.has(`${f}|${line.trim()}`)) code.push({ file: f, line: i + 1, text: line.trim().slice(0, 160) });
			else out.push(f);
		});
	}
	const counted = [...new Set(out)].map((file) => ({ file, count: out.filter((f) => f === file).length }));
	return { other: counted, code };
}

/** The whole plan for one table over one repo ({ files, read }). */
export function plan(table, repo) {
	const map = mapper(table.moves);
	const under = (list) => new Set(repo.files.filter((f) => (list || []).some((p) => f.startsWith(p))));
	const removed = new Set([...under(table.remove)].filter((f) => map(f) === f));
	const untracked = new Set([...under(table.untrack), ...removed]);
	const moves = renames(repo.files, map, untracked);
	const newOf = new Map(moves);
	const newPaths = repo.files.filter((f) => !untracked.has(f)).map((f) => newOf.get(f) ?? f);
	const oldFiles = new Set(repo.files);
	const newFiles = new Set(newPaths);
	const onDisk = new Set([...newFiles, ...[...untracked].filter((f) => !removed.has(f)).map(map)]);
	const base = { map, oldFiles, newFiles, onDisk, oldDirs: dirsOf(oldFiles), newDirs: dirsOf(onDisk), warnings: [], specifiers: table.specifiers || {}, bare: bareRule(table.specifiers), mentions: table.mentions || [], localize: [], listed: new Map((table.paths || []).map((p) => [p.file, p.replace.map((r) => r.from)])), kept: new Set((table.keep || []).map((k) => `${k.file}|${k.string}`)) };
	const localizeAll = (table.localize || []).map((l) => ({ ...l, rule: new RegExp(`(["'])${l.name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\1`, "g") }));
	const texts = new Map();
	const edits = new Map();
	const changes = [];
	for (const f of repo.files) {
		if (untracked.has(f)) continue;
		const to = newOf.get(f) ?? f;
		const text = MENTIONS.test(f) ? repo.read(f) : null;
		if (text != null) texts.set(to, text);
		if (text == null || !SCANNED.test(f) || skipped(f, table)) continue;
		const localize = f.endsWith(".json") ? [] : localizeAll.filter((l) => to.startsWith(l.within));
		const r = rewriteFile(text, { ...base, from: f, to, localize });
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
	return { moves, untrack: [...untracked].filter((f) => !removed.has(f)), remove: [...removed], newFiles, oldOf, edits, changes, warnings: base.warnings, ...(() => { const l = leftovers(table, [...newFiles], current); return { leftovers: l.other, codeLeftovers: l.code }; })() };
}

/** The tree as it is after a plan, for planning the next step on top of it without moving anything. */
export function after(repo, p) {
	const files = [...new Set([...p.newFiles, ...p.edits.keys()])].sort();
	const read = (f) => (p.edits.has(f) ? p.edits.get(f) : repo.read(p.oldOf.get(f) ?? f));
	return { files, read };
}
