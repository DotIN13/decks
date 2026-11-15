#!/usr/bin/env node
// Dry-runs every table in moves/order.json, each planned on top of the ones before it, and writes
// each one's <step>.dry.txt and <step>.renames.json beside it: node docs/rewrite/loom/dry-all.mjs
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkout, format, loadTable } from "./move.mjs";
import { after, plan } from "./plan.mjs";

const MOVES = new URL("moves/", import.meta.url).pathname;

function main() {
	const root = process.cwd();
	const head = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
	let repo = checkout(root);
	const done = [];
	for (const step of JSON.parse(readFileSync(join(MOVES, "order.json"), "utf8"))) {
		const table = loadTable(join(MOVES, `${step}.json`));
		const p = plan(table, repo);
		const at = done.length ? `${head}, on top of ${done.join(", ")}` : head;
		writeFileSync(join(MOVES, `${step}.dry.txt`), format(table, p, at));
		writeFileSync(join(MOVES, `${step}.renames.json`), `${JSON.stringify(p.moves.map(([from, to]) => ({ from, to })), null, "\t")}\n`);
		console.log(`${step}: ${p.moves.length} moves, ${p.remove.length} deleted, ${p.changes.length} lines rewritten, ${p.edits.size} files edited, ${p.warnings.length} warnings`);
		for (const w of p.warnings) console.log(`  warning: ${w}`);
		repo = after(repo, p);
		done.push(step);
	}
}

main();
