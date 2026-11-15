#!/usr/bin/env node
// Measures one split of a long file from its spec: node docs/rewrite/loom/split.mjs <spec.json> [--list]
// A spec names the file, the scope whose parts move (a class, a closure, or the whole file), and
// which part goes to which new file. It prints the sheet: each new file's lines, each part's home,
// and where every function still over 80 lines is cut. --list prints the parts and their sizes.
import { readFileSync } from "node:fs";
import ts from "typescript";
import { cssUnits, rustUnits } from "./split-text.mjs";

export const FILE_MAX = 400;
export const FUNCTION_MAX = 80;
const CHUNK = 60;

const lineOf = (sf, pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
/** A node's span with the comments above it, in lines of the file. */
const span = (sf, node) => ({ start: lineOf(sf, node.getFullStart() + (node.getFullText(sf).length - node.getFullText(sf).trimStart().length)), end: lineOf(sf, node.end) });

function nameOf(sf, node) {
	if (node.name) return node.name.getText(sf);
	if (ts.isVariableStatement(node)) return node.declarationList.declarations.map((d) => d.name.getText(sf)).join(",");
	if (ts.isExportAssignment(node)) return "export default";
	return `${ts.SyntaxKind[node.kind]}@${lineOf(sf, node.getStart(sf))}`;
}

/** The function, class or closure called `name` at the top of the file. */
function findScope(sf, name) {
	for (const s of sf.statements) {
		if ((ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s)) && s.name?.text === name) return s;
		if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) if (d.name.getText(sf) === name) return d.initializer;
	}
	throw new Error(`no top-level ${name}`);
}

/** The parts of a TypeScript file: top-level statements, or the members of one scope. */
export function tsUnits(path, text, scope) {
	const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
	const imports = sf.statements.filter(ts.isImportDeclaration).map((s) => ({ ...span(sf, s), names: (s.importClause?.getText(sf) ?? "").match(/[A-Za-z_$][\w$]*/g) ?? [] }));
	const unit = (node, inScope) => ({ name: nameOf(sf, node), ...span(sf, node), node, inScope, text: node.getText(sf) });
	const outer = sf.statements.filter((s) => !ts.isImportDeclaration(s));
	if (!scope) return { sf, imports, units: outer.map((n) => unit(n, false)) };
	const root = findScope(sf, scope);
	const members = ts.isClassDeclaration(root) || ts.isClassExpression(root) ? root.members : (root.body?.statements ?? []);
	const owner = ts.isVariableDeclaration(root.parent) ? root.parent.parent.parent : root;
	return { sf, imports, scopeSpan: span(sf, owner), scopeIsFunction: !members.length || !(ts.isClassDeclaration(root) || ts.isClassExpression(root)), units: [...outer.filter((s) => s !== owner).map((n) => unit(n, false)), ...[...members].map((n) => unit(n, true))] };
}

/** Parts to cut a long function at: its statements, or, for one huge statement, what it holds. */
function pieces(sf, node, depth = 0) {
	const body = node.body && ts.isBlock(node.body) ? node.body.statements : node.body ? [node.body] : node.getChildren(sf).flatMap((c) => (c.kind === ts.SyntaxKind.SyntaxList ? c.getChildren(sf) : [c]));
	const list = [...body].filter((n) => n.getText(sf).trim());
	const big = list.find((n) => span(sf, n).end - span(sf, n).start + 1 > FUNCTION_MAX);
	if (big && depth < 5 && list.length < 3) return pieces(sf, big, depth + 1);
	return list;
}

/** Where a long function is cut: chunks of about CHUNK lines, each starting at a statement. */
export function cuts(sf, fn) {
	const parts = pieces(sf, fn);
	const out = [];
	let from = null;
	for (const p of parts) {
		const s = span(sf, p);
		if (from === null) { from = s.start; continue; }
		if (s.end - from + 1 > CHUNK) { out.push({ line: s.start, at: p.getText(sf).split("\n")[0].trim().slice(0, 60) }); from = s.start; }
	}
	return out;
}

/** Every function inside a node that is over FUNCTION_MAX lines, outermost first, with its cuts. */
function longInside(sf, node) {
	const out = [];
	const visit = (n) => {
		if (ts.isFunctionLike(n) && "body" in n && n.body) {
			const s = span(sf, n);
			const len = lineOf(sf, n.end) - lineOf(sf, n.getStart(sf)) + 1;
			if (len > FUNCTION_MAX) out.push({ name: nameOf(sf, n.parent && ts.isVariableDeclaration(n.parent) ? n.parent : n), lines: len, start: s.start, cuts: cuts(sf, n) });
		}
		ts.forEachChild(n, visit);
	};
	visit(node);
	return out;
}

const matches = (name, rule) => (rule.startsWith("/") ? new RegExp(rule.slice(1, -1)).test(name) : rule === name);

/** Which new file each part goes to: the first target whose list names it, else the rest. */
function assign(units, spec) {
	const homes = new Map();
	for (const u of units) {
		const hit = Object.entries(spec.targets).find(([, rules]) => rules.some((r) => matches(u.name, r)));
		homes.set(u, hit ? hit[0] : spec.rest);
	}
	return homes;
}

/** The import lines a file needs: each import whose names its parts use. */
function importLines(imports, texts) {
	const used = imports.filter((i) => i.names.some((n) => texts.some((t) => new RegExp(`\\b${n.replace(/\$/g, "\\$")}\\b`).test(t))));
	return used.reduce((sum, i) => sum + i.end - i.start + 1, 0);
}

/** The whole sheet for one spec, as data. */
export function measure(spec, text) {
	const kind = /\.(rs)$/.test(spec.file) ? "rust" : /\.css$/.test(spec.file) ? "css" : "ts";
	const got = kind === "ts" ? tsUnits(spec.file, text, spec.scope) : kind === "rust" ? rustUnits(text, spec.scope) : cssUnits(text);
	const homes = assign(got.units, spec);
	const files = new Map([[spec.rest, []], ...Object.keys(spec.targets).map((t) => [t, []])]);
	for (const [u, home] of homes) files.get(home).push(u);
	const wrap = spec.wrap ?? (kind === "css" ? 2 : 1);
	const sizes = [...files].map(([file, us]) => {
		const body = us.reduce((sum, u) => sum + u.end - u.start + 1 + 1, 0);
		const head = kind === "ts" ? importLines(got.imports, us.map((u) => u.text)) + (file === spec.rest ? 0 : 1) : 0;
		const shell = file === spec.rest && got.scopeSpan ? 4 : 0;
		return { file, parts: us.map((u) => u.name), lines: body + head + shell + wrap + (spec.extra?.[file] ?? 0) };
	});
	const long = kind === "ts" ? got.units.flatMap((u) => longInside(got.sf, u.node).map((l) => ({ ...l, home: homes.get(u) }))) : [];
	const shell = got.scopeIsFunction ? files.get(spec.rest).filter((u) => u.inScope).reduce((s, u) => s + u.end - u.start + 1, 0) + 2 : null;
	return { kind, total: text.split("\n").length, sizes, long, shell };
}

/** The sheet as markdown. */
export function sheet(spec, m) {
	const out = [`## \`${spec.file}\` (${m.total} lines) → \`${spec.at}\``, ""];
	if (spec.pattern) out.push(`Pattern: ${spec.pattern}.`, "");
	if (spec.note) out.push(spec.note, "");
	out.push("| new file | lines | what goes there |", "|---|---|---|");
	for (const s of m.sizes) out.push(`| ${s.file} | ${s.lines}${s.lines > FILE_MAX ? " **over**" : ""} | ${s.parts.map((p) => `\`${p}\``).join(", ") || "(the entry and the shell)"} |`);
	if (m.shell !== null) out.push("", `The scope \`${spec.scope}\` keeps ${m.shell} lines of its own${m.shell > FUNCTION_MAX ? " **over 80: cut below**" : ""}; the parts that leave it take its shared state as one \`ctx\` argument.`);
	const long = m.long.filter((l) => !(spec.scope && l.name === spec.scope));
	out.push("", long.length ? "Functions still over 80 lines, and where each is cut (line numbers in today's file):" : "No function stays over 80 lines.", "");
	for (const l of long) out.push(`- \`${l.name}\` (${l.lines} lines, in ${l.home}): ${l.cuts.length ? l.cuts.map((c) => `L${c.line} \`${c.at.replace(/`/g, "'")}\``).join("; ") : "one statement; cut by hand at its branches"}`);
	return `${out.join("\n")}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const spec = JSON.parse(readFileSync(process.argv[2], "utf8"));
	const text = readFileSync(spec.file, "utf8");
	if (process.argv.includes("--list")) {
		const got = spec.file.endsWith(".rs") ? rustUnits(text, spec.scope) : spec.file.endsWith(".css") ? cssUnits(text) : tsUnits(spec.file, text, spec.scope);
		for (const u of got.units) console.log(`${u.end - u.start + 1}\t${u.inScope ? "  " : ""}${u.name}`);
	} else process.stdout.write(sheet(spec, measure(spec, text)));
}
