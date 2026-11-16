#!/usr/bin/env node
// Runs every gate against its baseline: node tools/gates/run.mjs [--only <gate>] [--root <dir>] [--shrink].
// --shrink lowers baselines to today's counts and never raises one. A baseline that grew since HEAD fails.
// --adopt <folder> records a moved folder's breaks (only folders in MOVED); its commit is then the growth.
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { MOVED, ROOT, adoptBaseline, compare, context, readBaseline, writeBaseline } from "./lib.mjs";
import { rekeyed, splitKeys, stagedRenames, stagedSplit, units } from "./rekey.mjs";

export const GATES = ["size", "names", "imports", "calls", "readme", "comments", "commits", "parts", "state", "built", "lanes", "agents-md", "legacy", "strays"];

export async function runGates({ root = ROOT, only, shrink = false, init = false, adopt, quiet = false } = {}) {
	if (adopt && !MOVED.includes(adopt)) throw new Error(`--adopt takes a moved folder: ${MOVED.join(", ")}`);
	const ctx = context(root);
	const results = [];
	for (const gate of await loadGates(only)) {
		const { counts, notes } = gate.scan(ctx);
		if (adopt) adoptBaseline(root, gate.name, counts, adopt);
		else if (init || shrink) writeBaseline(root, gate.name, counts, !init);
		const { over, fixed } = compare(counts, readBaseline(root, gate.name));
		const problems = [...over.map((o) => (o.was ? `${o.key} (${o.n}, was ${o.was})` : o.key)), ...(adopt ? [] : grown(root, gate.name))];
		results.push({ name: gate.name, rule: gate.rule, problems, fixed, notes });
		if (!quiet) report(gate.name, problems, fixed, notes);
	}
	return results;
}

export async function loadGates(only) {
	const names = only ? GATES.filter((g) => g === only) : GATES;
	return Promise.all(names.map(async (n) => (await import(`./${n}.mjs`)).default));
}

/** Keys a baseline gained, or counts it raised, since the last commit. */
export function grown(root, name) {
	let before;
	try {
		before = JSON.parse(execFileSync("git", ["show", `HEAD:tools/gates/baseline/${name}.json`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
	} catch { return []; }
	// A key that moved with a file staged as renamed (git mv, then rekey.mjs) is the same exception, not growth.
	const pairs = stagedRenames(root);
	if (pairs.length) {
		const moving = units(pairs);
		before = Object.entries(before).reduce((all, [k, n]) => ((all[rekeyed(k, pairs, moving)] = (all[rekeyed(k, pairs, moving)] ?? 0) + n), all), {});
	}
	const now = readBaseline(root, name);
	// A file split into new ones, all staged: its exceptions moved onto them, not gained, while their total holds.
	const split = splitKeys(before, now, stagedSplit(root));
	return Object.keys(now).filter((k) => now[k] > (before[k] ?? 0) && !split.has(k)).map((k) => `baseline gained ${k}`);
}

function report(name, problems, fixed, notes) {
	console.log(`${problems.length ? "FAIL" : "pass"}  ${name}${fixed.length ? `  (${fixed.length} exceptions fixed: run with --shrink)` : ""}`);
	for (const p of problems.slice(0, 40)) console.log(`      ${p}`);
	if (problems.length > 40) console.log(`      … and ${problems.length - 40} more`);
	for (const n of notes) console.log(`      note: ${n}`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
	const arg = (flag) => { const i = process.argv.indexOf(flag); return i > 0 ? process.argv[i + 1] : undefined; };
	const root = arg("--root") ? resolve(arg("--root")) : ROOT;
	const adopt = arg("--adopt")?.replace(/\/?$/, "/");
	const results = await runGates({ root, only: arg("--only"), adopt, shrink: process.argv.includes("--shrink"), init: process.argv.includes("--init") });
	const failed = results.filter((r) => r.problems.length);
	console.log(failed.length ? `${failed.length} of ${results.length} gates fail` : `all ${results.length} gates pass`);
	process.exitCode = failed.length ? 1 : 0;
}
