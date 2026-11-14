// Rule 7: a commit title is 72 characters at most; the body says why and has a "Checked:" line.
// As a commit-msg hook: node tools/gates/commits.mjs --hook <message file> (installed by install-hooks.mjs).
// As a gate: every commit since the branch was cut (REWRITE_BASE, default c669a67f; all commits if absent).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const TITLE_MAX = 72;
const BASE = process.env.REWRITE_BASE || "c669a67f";

export function messageProblems(message) {
	const lines = message.split("\n").filter((l) => !l.startsWith("#"));
	const title = lines[0] || "";
	const body = lines.slice(1).join("\n").trim();
	const out = [];
	if (!title.trim()) out.push("has no title");
	if (title.length > TITLE_MAX) out.push(`title is ${title.length} characters, over ${TITLE_MAX}`);
	if (lines.length > 1 && lines[1].trim()) out.push("needs a blank line after the title");
	if (!body) out.push("has no body saying why");
	else if (!/^checked:/im.test(body)) out.push('body has no "Checked:" line');
	return out;
}

function git(root, args) {
	return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 26 });
}

function commitsSince(root) {
	let range = "HEAD";
	try { git(root, ["cat-file", "-e", `${BASE}^{commit}`]); range = `${BASE}..HEAD`; } catch {}
	try {
		return git(root, ["log", "--format=%H%x00%B%x01", range]).split("\x01").map((c) => c.trim()).filter(Boolean)
			.map((c) => { const [sha, msg] = c.split("\x00"); return { sha: sha.trim(), msg: msg || "" }; });
	} catch { return []; }
}

const gate = {
	name: "commits",
	rule: "7. A commit title is 72 characters at most; the body says why and what was checked.",
	scan({ root }) {
		const counts = new Map();
		if (existsSync(join(root, ".git"))) {
			for (const c of commitsSince(root)) for (const p of messageProblems(c.msg)) counts.set(`${c.sha.slice(0, 8)}: ${p}`, 1);
		}
		return { counts, notes: [`Commits since ${BASE}. Install the hook: node tools/gates/install-hooks.mjs.`] };
	},
};
export default gate;

if (process.argv[2] === "--hook") {
	const problems = messageProblems(readFileSync(process.argv[3], "utf8"));
	for (const p of problems) console.error(`commit message ${p} (rule 7, DESIGN.md section 6)`);
	process.exitCode = problems.length ? 1 : 0;
}
