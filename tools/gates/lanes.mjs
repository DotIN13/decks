// The lanes gate: a commit touches only paths in its author's lane (docs/rewrite/lanes.json, path prefixes).
// The author is REWRITE_AGENT=<your name>; the pre-commit hook runs: node tools/gates/lanes.mjs --staged.
// As a gate it checks lanes.json: no path in two lanes. A longer path inside another's folder is a carve-out, allowed.
// The key "*" is the shared lane: any agent with a lane may commit its paths (the gate baselines a split carries).
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { readFileSync } from "node:fs";

const LANES = "docs/rewrite/lanes.json";
/** The shared lane's key: its paths are every lane's, and no lane's in the overlap check. */
export const SHARED = "*";

export function outsideLane(lanes, agent, paths) {
	const mine = agent === SHARED ? undefined : lanes[agent];
	if (!mine) return paths.map((p) => `${p}: REWRITE_AGENT=${agent || "(unset)"} has no lane in ${LANES}`);
	const open = [...mine, ...(lanes[SHARED] ?? [])];
	return paths.filter((p) => !open.some((prefix) => p === prefix || (prefix.endsWith("/") && p.startsWith(prefix))))
		.map((p) => `${p}: outside ${agent}'s lane`);
}

export function overlaps(lanes) {
	const out = [];
	const all = Object.entries(lanes).filter(([agent]) => agent !== SHARED).flatMap(([agent, paths]) => paths.map((p) => ({ agent, p })));
	for (const a of all) for (const b of all) {
		if (a.agent < b.agent && a.p === b.p) {
			out.push(`${LANES}: ${a.p} is in the lanes of ${a.agent} and ${b.agent}`);
		}
	}
	return out;
}

export default {
	name: "lanes",
	rule: "Lanes: a commit touches only its author's paths.",
	scan({ exists, read }) {
		const counts = new Map();
		if (!exists(LANES)) return { counts, notes: [`${LANES} does not exist.`] };
		for (const o of overlaps(JSON.parse(read(LANES)))) counts.set(o, 1);
		return { counts, notes: ["Commits are checked by the pre-commit hook (node tools/gates/install-hooks.mjs), with REWRITE_AGENT set."] };
	},
};

if (process.argv[2] === "--staged") {
	const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
	const staged = execFileSync("git", ["-c", "core.quotePath=false", "diff", "--cached", "--name-only"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
	const problems = outsideLane(JSON.parse(readFileSync(join(root, LANES), "utf8")), process.env.REWRITE_AGENT, staged);
	for (const p of problems) console.error(`lanes: ${p}`);
	if (problems.length) console.error("Commit only your own paths: git commit -m \"...\" -- <your paths>. Set REWRITE_AGENT=<your name>.");
	process.exitCode = problems.length ? 1 : 0;
}
