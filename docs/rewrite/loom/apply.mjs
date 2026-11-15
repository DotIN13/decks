// Applies a plan from plan.mjs to a checkout: untrack, git mv, carry untracked leftovers, write edits.
// It stages what it touched and commits nothing; the caller checks, then commits.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { mapper } from "./plan.mjs";

const git = (root, args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** Carries what git does not track (built files, target/) under a moved folder to its new place. */
function carryLeftovers(root, rel, map, notes) {
	const abs = join(root, rel);
	if (!existsSync(abs)) return;
	for (const name of readdirSync(abs)) {
		const p = `${rel}/${name}`;
		if (name === "node_modules") { rmSync(join(root, p), { recursive: true, force: true }); notes.push(`removed ${p} (npm install remakes it)`); continue; }
		const to = map(p);
		if (to === p) continue;
		if (!existsSync(join(root, to))) {
			mkdirSync(dirname(join(root, to)), { recursive: true });
			renameSync(join(root, p), join(root, to));
			notes.push(`carried ${p} -> ${to} (not tracked)`);
		} else if (statSync(join(root, p)).isDirectory()) carryLeftovers(root, p, map, notes);
		else notes.push(`left ${p}: ${to} already exists`);
	}
}

/** Removes folders left empty under a moved folder, deepest first. */
function removeEmpty(root, rel) {
	const abs = join(root, rel);
	if (!existsSync(abs) || !statSync(abs).isDirectory()) return;
	for (const name of readdirSync(abs)) removeEmpty(root, `${rel}/${name}`);
	if (!readdirSync(abs).length) rmSync(abs, { recursive: true });
}

/** Removes a moved folder's parents once they are empty, up to the root. */
function removeEmptyParents(root, rel) {
	for (let d = dirname(rel); d !== "." && existsSync(join(root, d)) && !readdirSync(join(root, d)).length; d = dirname(d)) rmSync(join(root, d), { recursive: true });
}

/** Runs the plan. Returns notes on what it carried or left, for the caller to read. */
export function apply(root, table, p) {
	const notes = [];
	if (p.untrack.length) git(root, ["rm", "-r", "-q", "--cached", "--", ...(table.untrack || [])]);
	if (p.remove.length) git(root, ["rm", "-r", "-q", "--", ...(table.remove || [])]);
	for (const [from, to] of p.moves) {
		mkdirSync(dirname(join(root, to)), { recursive: true });
		git(root, ["mv", "--", from, to]);
	}
	const map = mapper(table.moves);
	const folders = table.moves.filter((m) => m.from.endsWith("/")).map((m) => m.from.slice(0, -1));
	for (const f of folders) carryLeftovers(root, f, map, notes);
	for (const [file, text] of p.edits) {
		mkdirSync(dirname(join(root, file)), { recursive: true });
		writeFileSync(join(root, file), text);
	}
	if (p.edits.size) git(root, ["add", "--", ...p.edits.keys()]);
	for (const f of folders) { removeEmpty(root, f); removeEmptyParents(root, f); }
	return notes;
}
