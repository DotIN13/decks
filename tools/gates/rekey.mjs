#!/usr/bin/env node
// Moves gate baseline keys with the files they name, same counts: a moved file's exceptions stay its own.
// node tools/gates/rekey.mjs <old> <new> [<old> <new> ...]   a file or a folder (every key under it)
// node tools/gates/rekey.mjs --staged                         every rename staged in git (git mv)
// Commit the baselines with the move; until then the gates read the new keys as grown since HEAD.
import { execFileSync } from "node:child_process";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, readBaseline } from "./lib.mjs";

/** A key's path: "path: what", or "stale-paths: path: what" for the legacy gate. */
const PREFIX = /^(stale-paths: )?([^:]+)(:.*)?$/;

/** The path moved by the first pair that names it: the same file, or a file under a moved folder. */
export function moved(path, pairs) {
	for (const [from, to] of pairs) {
		if (path === from) return to;
		if (path.startsWith(`${from.replace(/\/$/, "")}/`)) return `${to.replace(/\/$/, "")}/${path.slice(from.replace(/\/$/, "").length + 1)}`;
	}
	return path;
}

/** Every baseline re-keyed by pairs; a key landing on one already there adds its count. Answers the keys moved. */
export function rekey(root, pairs) {
	const dir = join(root, "tools/gates/baseline");
	let count = 0;
	for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
		const name = file.replace(/\.json$/, "");
		const next = {};
		for (const [key, n] of Object.entries(readBaseline(root, name))) {
			const [, legacy = "", path, rest = ""] = PREFIX.exec(key) ?? [];
			const to = path === undefined ? key : `${legacy}${moved(path, pairs)}${rest}`;
			if (to !== key) count++;
			next[to] = (next[to] ?? 0) + n;
		}
		const sorted = Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)));
		writeFileSync(join(dir, file), `${JSON.stringify(sorted, null, "\t")}\n`);
	}
	return count;
}

/** The renames staged in git, as [old, new] pairs. */
export function stagedRenames(root) {
	const out = execFileSync("git", ["diff", "--cached", "-M", "--name-status"], { cwd: root, encoding: "utf8" });
	return out.split("\n").filter((l) => /^R\d*\t/.test(l)).map((l) => l.split("\t").slice(1, 3));
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
	const args = process.argv.slice(2);
	const pairs = args.includes("--staged") ? stagedRenames(ROOT) : args.reduce((all, a, i) => (i % 2 ? all : [...all, [a, args[i + 1]]]), []);
	if (!pairs.length || pairs.some(([from, to]) => !from || !to)) {
		console.error("usage: node tools/gates/rekey.mjs <old> <new> [<old> <new> ...] | --staged");
		process.exitCode = 2;
	} else console.log(`re-keyed ${rekey(ROOT, pairs)} baseline key(s) for ${pairs.length} move(s)`);
}
