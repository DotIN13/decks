// AGENTS.md, the map: 150 lines at most, and every path it names exists.
// A path is a backticked word with a slash or a file extension; a word with <, *, or a space is a pattern, not a path.
import { lineCount } from "./lib.mjs";

export const AGENTS_MAX = 150;

export function namedPaths(text) {
	const out = [];
	for (const m of text.matchAll(/`([^`\n]+)`/g)) {
		const w = m[1].trim();
		if (/[<>*\s{}|$]/.test(w) || /^(node|npm|git|decks)\b/.test(w)) continue;
		if (/^[\w.@-]+(\/[\w.@-]*)+$/.test(w) || /^[\w.-]+\.(md|json|ts|tsx|mjs|css|rs)$/.test(w)) out.push(w.replace(/\/$/, ""));
	}
	return out;
}

export default {
	name: "agents-md",
	rule: "AGENTS.md is 150 lines at most and names only paths that exist.",
	scan({ exists, read }) {
		const counts = new Map();
		if (!exists("AGENTS.md")) return { counts: new Map([["AGENTS.md: missing", 1]]), notes: [] };
		const text = read("AGENTS.md");
		if (lineCount(text) > AGENTS_MAX) counts.set(`AGENTS.md: over ${AGENTS_MAX} lines`, 1);
		for (const p of namedPaths(text)) if (!exists(p)) counts.set(`AGENTS.md: names ${p}, which does not exist`, 1);
		return { counts, notes: [] };
	},
};
