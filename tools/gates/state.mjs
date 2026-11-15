// Rule 9: changing values live in a store, never loose at the top of a file.
// Counts each top-level let or var in a module. Not checked: a top-level const holding a Map, array or object that is changed later.
import ts from "typescript";
import { CODE, bump, isSource } from "./lib.mjs";

export default {
	name: "state",
	rule: "9. Changing values live in a store, never loose at the top of a file.",
	scan({ files, read }) {
		const counts = new Map();
		for (const f of files.filter((f) => isSource(f) && CODE.test(f) && !/\.test\./.test(f))) {
			for (const name of looseValues(f, read(f))) bump(counts, `${f}: top-level let ${name}`);
		}
		return { counts, notes: ["Not checked: a top-level const Map, array or object changed later.", "Test files are not counted."] };
	},
};

export function looseValues(path, text) {
	const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, /\.tsx$/.test(path) ? ts.ScriptKind.TSX : undefined);
	const names = [];
	for (const st of sf.statements) {
		if (!ts.isVariableStatement(st)) continue;
		const flags = st.declarationList.flags;
		if (flags & (ts.NodeFlags.Const | ts.NodeFlags.Using | ts.NodeFlags.AwaitUsing)) continue;
		if (st.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword)) continue;
		for (const d of st.declarationList.declarations) names.push(ts.isIdentifier(d.name) ? d.name.text : "(pattern)");
	}
	return names;
}
