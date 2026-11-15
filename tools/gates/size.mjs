// Rule 1: a file holds 1,000 lines at most, a function 80.
// Files of code, styles and Rust are measured; functions in TypeScript and JavaScript only, by the compiler's parse.
import ts from "typescript";
import { CODE, bump, isSource, lineCount } from "./lib.mjs";

const MEASURED = /\.(ts|tsx|mts|mjs|js|cjs|css|rs|wgsl|swift)$/;

export const FILE_MAX = 1000;

export const FUNCTION_MAX = 80;

export default {
	name: "size",
	rule: "1. A file holds 1,000 lines at most, a function 80.",
	scan({ files, read }) {
		const counts = new Map();
		for (const f of files.filter((f) => isSource(f) && MEASURED.test(f))) {
			const text = read(f);
			if (lineCount(text) > FILE_MAX) bump(counts, `${f}: over ${FILE_MAX} lines`);
			if (CODE.test(f)) for (const fn of longFunctions(f, text)) bump(counts, `${f}: function ${fn.name} over ${FUNCTION_MAX} lines`);
		}
		return { counts, notes: ["Functions are measured in TypeScript and JavaScript only, not in Rust, CSS or Swift."] };
	},
};

/** Each function longer than FUNCTION_MAX lines, as its name and its length. */
export function longFunctions(path, text) {
	const kind = /\.tsx$/.test(path) ? ts.ScriptKind.TSX : /\.(m|c)?js$/.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
	const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
	const out = [];
	const visit = (node) => {
		if (ts.isFunctionLike(node) && "body" in node && node.body) {
			const start = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
			const end = sf.getLineAndCharacterOfPosition(node.end).line;
			if (end - start + 1 > FUNCTION_MAX) out.push({ name: functionName(node), lines: end - start + 1 });
		}
		ts.forEachChild(node, visit);
	};
	visit(sf);
	return out;
}

function functionName(node) {
	if (node.name && ts.isIdentifier(node.name)) return node.name.text;
	const p = node.parent;
	if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
	if (p && ts.isPropertyAssignment(p) && p.name && ts.isIdentifier(p.name)) return p.name.text;
	return "(anonymous)";
}
