#!/usr/bin/env node
// Applies a top-level split from its spec: node docs/rewrite/loom/apply-split.mjs <spec.json> [--dry]
// Each target file gets the declarations its spec names, with their comments; it imports what it uses
// from the original's imports and from its siblings; whatever crosses files is exported; the original
// keeps the rest and re-exports the names it exported before, so no importer changes. A spec with a
// scope (a class or closure) is not this tool's: those are split by hand.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import ts from "typescript";

const lineOf = (sf, pos) => sf.getLineAndCharacterOfPosition(pos).line;

/** The names a statement declares at the top of its file. */
function declared(node) {
	if (ts.isVariableStatement(node)) return node.declarationList.declarations.flatMap((d) => (ts.isIdentifier(d.name) ? [d.name.text] : []));
	if (node.name && ts.isIdentifier(node.name)) return [node.name.text];
	return [];
}

const isExported = (node) => !!node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

/** The identifiers a node reads, leaving out property names and the names of object keys. */
function used(node, out = new Set()) {
	const visit = (n) => {
		if (ts.isIdentifier(n)) {
			const p = n.parent;
			const isProperty = p && ((ts.isPropertyAccessExpression(p) && p.name === n) || ((ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p)) && p.name === n));
			if (!isProperty) out.add(n.text);
		}
		ts.forEachChild(n, visit);
	};
	visit(node);
	return out;
}

/** The text of a statement with the comments above it. */
const textOf = (sf, node) => sf.text.slice(node.getFullStart(), node.end).replace(/^\s*\n/, "");

function withExport(text, node) {
	if (isExported(node)) return text;
	const start = node.getStart() - node.getFullStart();
	const lead = text.length - (node.end - node.getStart());
	return `${text.slice(0, lead)}export ${text.slice(lead)}`;
}

export function applySplit(spec, root = process.cwd()) {
	if (spec.scope) throw new Error(`${spec.file}: a scope (${spec.scope}) is split by hand`);
	const path = join(root, spec.file);
	const sf = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
	const imports = sf.statements.filter(ts.isImportDeclaration);
	const rest = sf.statements.filter((s) => !ts.isImportDeclaration(s));
	const home = new Map();
	for (const s of rest) {
		const names = declared(s);
		const target = Object.entries(spec.targets).find(([, rules]) => names.some((n) => rules.includes(n)))?.[0];
		home.set(s, target ?? spec.rest);
	}
	const fileOfName = new Map();
	const typeNames = new Set();
	for (const [s, file] of home) for (const n of declared(s)) {
		fileOfName.set(n, file);
		if (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)) typeNames.add(n);
	}
	const crossing = new Set();
	for (const [s, file] of home) for (const n of used(s)) if (fileOfName.has(n) && fileOfName.get(n) !== file) crossing.add(n);
	const files = new Map([...new Set(home.values())].map((f) => [f, []]));
	for (const [s, file] of home) files.get(file).push(s);
	const out = {};
	for (const [file, statements] of files) {
		const names = new Set(statements.flatMap((s) => [...used(s)]));
		const lines = [];
		for (const imp of imports) {
			const clause = imp.importClause;
			const spec_ = imp.moduleSpecifier.getText(sf);
			if (!clause) { if (file === spec.rest) lines.push(imp.getText(sf)); continue; }
			const typeOnly = clause.isTypeOnly;
			const bindings = clause.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements : [];
			const keep = bindings.filter((b) => names.has(b.name.text)).map((b) => b.getText(sf));
			const def = clause.name && names.has(clause.name.text) ? clause.name.text : undefined;
			const ns = clause.namedBindings && ts.isNamespaceImport(clause.namedBindings) && names.has(clause.namedBindings.name.text) ? clause.namedBindings.getText(sf) : undefined;
			if (!keep.length && !def && !ns) continue;
			const parts = [def, ns, keep.length ? `{ ${keep.join(", ")} }` : undefined].filter(Boolean).join(", ");
			lines.push(`import ${typeOnly ? "type " : ""}${parts} from ${spec_};`);
		}
		const bySibling = new Map();
		for (const n of names) {
			const from = fileOfName.get(n);
			if (!from || from === file) continue;
			if (!bySibling.has(from)) bySibling.set(from, new Set());
			bySibling.get(from).add(n);
		}
		for (const [from, ns] of bySibling) lines.push(`import { ${[...ns].sort().map((n) => (typeNames.has(n) ? `type ${n}` : n)).join(", ")} } from "./${from.split("/").pop()}";`);
		const body = statements.map((s) => (declared(s).some((n) => crossing.has(n)) ? withExport(textOf(sf, s), s) : textOf(sf, s)));
		if (file === spec.rest) {
			for (const [target, statements2] of files) {
				if (target === spec.rest) continue;
				const isType = (s) => ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s);
				const exported = statements2.filter(isExported).flatMap((s) => declared(s).map((n) => (isType(s) ? `type ${n}` : n)));
				if (exported.length) lines.push(`export { ${exported.join(", ")} } from "./${target.split("/").pop()}";`);
			}
		}
		out[file] = `${lines.join("\n")}\n\n${body.join("\n").replace(/^\n+/, "")}\n`;
	}
	return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const spec = JSON.parse(readFileSync(process.argv[2], "utf8"));
	const out = applySplit(spec);
	const dir = dirname(spec.file);
	for (const [file, text] of Object.entries(out)) {
		const to = join(dir, file);
		if (process.argv.includes("--dry")) console.log(`${to}: ${text.split("\n").length} lines`);
		else writeFileSync(to, text);
	}
}
