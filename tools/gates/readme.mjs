// Rule 5: every folder has a README of 60 lines at most, with four headings: Owns, May import, Rules, Check.
// Folders: each new top folder, its direct subfolders, each clients/<name>, and today's packages and apps.
// Leaf folders of data or of one kind of file (calls, checks, baseline, doors, fixtures' insides) are skipped.
import { lineCount } from "./lib.mjs";

const TOPS = ["protocol", "server", "harness", "tools", "canvas", "engine", "pen", "ui", "clients"];

const OLD_UNITS = /^(packages\/[^/]+|apps\/[^/]+|runtime|extension|e2e|scripts)$/;

const SKIP = new Set(["calls", "checks", "baseline", "doors", "node_modules", "dist", "dist-gen", "src", "styles", "lib"]);

const HEADINGS = ["owns", "may import", "rules", "check"];

export const README_MAX = 60;

export default {
	name: "readme",
	rule: "5. Every folder has a README of 60 lines at most: owns, may import, rules, how to check.",
	scan(ctx) {
		const counts = new Map();
		for (const dir of folders(ctx.files)) {
			const path = `${dir}/README.md`;
			for (const p of problems(ctx.exists(path) ? ctx.read(path) : null)) counts.set(`${dir}: ${p}`, 1);
		}
		return { counts, notes: [] };
	},
};

export function problems(text) {
	if (text === null) return ["has no README.md"];
	const out = [];
	if (lineCount(text) > README_MAX) out.push(`README over ${README_MAX} lines`);
	const heads = text.split("\n").filter((l) => /^#{1,4}\s/.test(l)).map((l) => l.toLowerCase());
	for (const h of HEADINGS) if (!heads.some((l) => l.includes(h))) out.push(`README has no "${h}" heading`);
	return out;
}

/** The folders the rule covers, found from the files in the tree. */
export function folders(files) {
	const out = new Set();
	for (const f of files) {
		const s = f.split("/");
		if (s[0] === "tools" && s[1] === "fixtures" && s.length > 3) continue;
		for (let depth = 1; depth < s.length; depth++) {
			const dir = s.slice(0, depth).join("/");
			const covered = (TOPS.includes(s[0]) && depth <= 2 && !(s[0] === "clients" && depth === 1)) || OLD_UNITS.test(dir);
			if (covered && !SKIP.has(s[depth - 1])) out.add(dir);
		}
	}
	return [...out].sort();
}
