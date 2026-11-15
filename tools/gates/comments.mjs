// Rule 6: a comment states the rule in 5 lines or fewer; the story goes in docs/decisions/.
// Comments in code, styles and Rust are measured; touching line comments count as one comment.
// Plain words: no em dash in a comment or in a Markdown file.
import ts from "typescript";
import { CODE, bump, isSource } from "./lib.mjs";

export const COMMENT_MAX = 5;

const STYLE = /\.(css|rs|wgsl|swift)$/;

export default {
	name: "comments",
	rule: "6. A comment states the rule in 5 lines or fewer; no em dashes.",
	scan({ files, read }) {
		const counts = new Map();
		for (const f of files.filter(isSource)) {
			if (f.endsWith(".md")) {
				const n = (read(f).match(/—/g) || []).length;
				if (n) bump(counts, `${f}: em dash`, n);
				continue;
			}
			if (!CODE.test(f) && !STYLE.test(f)) continue;
			for (const c of comments(f, read(f))) {
				if (c.to - c.from + 1 > COMMENT_MAX) bump(counts, `${f}: comment over ${COMMENT_MAX} lines`);
				const dashes = (c.text.match(/—/g) || []).length;
				if (dashes) bump(counts, `${f}: em dash`, dashes);
			}
		}
		return { counts, notes: [] };
	},
};

/** Comments with touching line comments joined, each as its first and last line and its words. */
export function comments(path, text) {
	const raw = CODE.test(path) ? tsComments(path, text) : styleComments(text);
	const out = [];
	for (const c of raw) {
		const last = out[out.length - 1];
		if (last && c.single && last.single && c.from === last.to + 1) Object.assign(last, { to: c.to, text: `${last.text}\n${c.text}` });
		else out.push({ ...c });
	}
	return out;
}

function tsComments(path, text) {
	const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, /\.tsx$/.test(path) ? ts.ScriptKind.TSX : undefined);
	const found = new Map();
	const add = (ranges) => { for (const r of ranges || []) found.set(r.pos, r); };
	const visit = (node) => {
		add(ts.getLeadingCommentRanges(text, node.pos));
		add(ts.getTrailingCommentRanges(text, node.end));
		ts.forEachChild(node, visit);
	};
	visit(sf);
	add(ts.getLeadingCommentRanges(text, sf.endOfFileToken.pos));
	const line = (pos) => sf.getLineAndCharacterOfPosition(pos).line;
	return [...found.values()].sort((a, b) => a.pos - b.pos).map((r) => ({
		from: line(r.pos), to: line(r.end), text: text.slice(r.pos, r.end), single: r.kind === ts.SyntaxKind.SingleLineCommentTrivia,
	}));
}

function styleComments(text) {
	const out = [];
	const lines = text.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const l = lines[i].trim();
		if (l.startsWith("//")) out.push({ from: i, to: i, text: l, single: true });
		else if (l.includes("/*")) {
			let j = i;
			while (j < lines.length - 1 && !lines[j].includes("*/")) j++;
			out.push({ from: i, to: j, text: lines.slice(i, j + 1).join("\n"), single: false });
			i = j;
		}
	}
	return out;
}
