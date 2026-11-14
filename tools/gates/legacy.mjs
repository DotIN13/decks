// The repo's four gates from before the rewrite, called where they are: dead exports, dead CSS, stale paths, the surface.
// Each indented line a failing script prints is one break, its line numbers dropped so the key stays put.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { bump } from "./lib.mjs";

export const SCRIPTS = ["dead-exports", "dead-css", "stale-paths", "surface-gate"];

export function breaks(script, output) {
	const lines = output.split("\n").filter((l) => /^\s{2,}\S/.test(l)).map((l) => l.trim().replace(/:\d+(?=[:\s])/g, ""));
	return lines.length ? lines.map((l) => `${script}: ${l}`) : [`${script}: failed (${output.trim().split("\n")[0] || "no output"})`];
}

export default {
	name: "legacy",
	rule: "The repo's earlier gates: dead exports, dead CSS, stale paths, the canvas surface.",
	scan({ root }) {
		const counts = new Map();
		const notes = [];
		for (const s of SCRIPTS) {
			const path = join(root, "scripts", `${s}.mjs`);
			if (!existsSync(path)) { notes.push(`scripts/${s}.mjs is not in this tree.`); continue; }
			const r = spawnSync(process.execPath, [path], { cwd: root, encoding: "utf8" });
			if (r.status !== 0) for (const b of breaks(s, r.stdout + r.stderr)) bump(counts, b);
		}
		return { counts, notes };
	},
};
