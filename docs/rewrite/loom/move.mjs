#!/usr/bin/env node
// Moves one step of the canvas libraries by its table: node docs/rewrite/loom/move.mjs <table.json> --dry
// --dry prints the plan (--out <file> writes it, --renames <file> writes the old-to-new list).
// --go applies it, and only when Mason has said go. Nothing else is written, and nothing is committed.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { apply } from "./apply.mjs";
import { plan } from "./plan.mjs";

const MAX_BYTES = 2_000_000;

/** A checkout as plan.mjs reads it: tracked files, and the text of those it may need. */
export function checkout(root) {
	const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 }).split("\0").filter(Boolean);
	const read = (f) => {
		try {
			const abs = join(root, f);
			return statSync(abs).size > MAX_BYTES ? null : readFileSync(abs, "utf8");
		} catch { return null; }
	};
	return { files, read };
}

/** A table from its file, each new file's text read from beside the table. */
export function loadTable(path) {
	const table = JSON.parse(readFileSync(path, "utf8"));
	for (const c of table.create || []) c.text = readFileSync(join(dirname(path), c.from), "utf8");
	return table;
}

const head = (root) => { try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim(); } catch { return "?"; } };

/** The plan as text: counts, then every move, every changed line, warnings, old paths left, what to run. */
export function format(table, p, at) {
	const out = [`# Step ${table.step}: ${table.title}`, "", `Dry run on ${at}. Nothing was moved.`, ""];
	out.push(`- files moved by git mv: ${p.moves.length}`, `- files taken out of git (moved on disk): ${p.untrack.length}`);
	out.push(`- files edited or created: ${p.edits.size}`, `- import lines rewritten: ${p.changes.length}`, `- warnings: ${p.warnings.length}`, "");
	if (p.untrack.length) out.push("## Taken out of git", "", ...p.untrack.map((f) => `- ${f}`), "");
	out.push("## Moved", "", ...p.moves.map(([a, b]) => `- ${a} -> ${b}`), "");
	out.push("## Lines rewritten", "");
	for (const c of p.changes) out.push(`${c.file}:${c.line}`, `  - ${c.before.trim()}`, `  + ${c.after.trim()}`);
	const rewritten = new Set(p.changes.map((c) => c.file));
	const other = [...p.edits.keys()].filter((f) => !rewritten.has(f));
	out.push("", "## Files the table edits or creates", "", ...[...p.edits.keys()].filter((f) => other.includes(f)).map((f) => `- ${f}`), "");
	out.push("## Warnings", "", ...(p.warnings.length ? p.warnings.map((w) => `- ${w}`) : ["- none"]), "");
	out.push("## Old paths still written (not rewritten: comments and docs)", "");
	out.push(...(p.leftovers.length ? p.leftovers.map((l) => `- ${l.file}: ${l.count}`) : ["- none"]), "");
	out.push("## Then run", "", ...(table.then || []).map((t) => `- ${t}`), "");
	return out.join("\n");
}

function main(argv) {
	const [tablePath, ...flags] = argv;
	const opt = (name) => { const i = flags.indexOf(name); return i < 0 ? null : flags[i + 1]; };
	if (!tablePath || (!flags.includes("--dry") && !flags.includes("--go"))) {
		console.error("usage: node docs/rewrite/loom/move.mjs <table.json> --dry [--out file] [--renames file] [--root dir] | --go");
		process.exit(2);
	}
	const root = resolve(opt("--root") ?? process.cwd());
	const table = loadTable(tablePath);
	const p = plan(table, checkout(root));
	if (flags.includes("--go")) {
		for (const n of apply(root, table, p)) console.log(n);
		console.log(`moved ${p.moves.length} files, edited ${p.edits.size}; staged, not committed. Then run:`);
		for (const t of table.then || []) console.log(`  ${t}`);
		return;
	}
	const text = format(table, p, head(root));
	if (opt("--out")) writeFileSync(opt("--out"), text);
	else process.stdout.write(text);
	if (opt("--renames")) writeFileSync(opt("--renames"), `${JSON.stringify(p.moves.map(([from, to]) => ({ from, to })), null, "\t")}\n`);
	console.error(`${p.moves.length} moves, ${p.changes.length} lines rewritten, ${p.edits.size} files edited, ${p.warnings.length} warnings`);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
