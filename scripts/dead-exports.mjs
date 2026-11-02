#!/usr/bin/env node
/**
 * Exports nothing reads: a gate beside `css-order.mjs`.
 *
 *     node scripts/dead-exports.mjs            # exit 1, naming each export no other file references
 *     node scripts/dead-exports.mjs --all      # also list exports only a test or a doc references
 *
 * For every `export (function|const|let|class|interface|type|enum) Name` in a tracked source file, the
 * whole-word references to `Name` in every other tracked text file are counted. None at all is dead.
 * A package's entry points (`index.ts`, `public/*.ts`, what `package.json` `exports` names, and any
 * module one of them re-exports whole) are the package's API whether or not this repository uses it,
 * so their exports are left out; so are the runtime's plugin and tool modules, which another program
 * loads by convention.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const all = process.argv.includes("--all");
const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
const vendored = (f) => /\/(lib|vendor|pkg|pkg-gl)\//.test(f) || /\.bundle\.|\.min\./.test(f) || f.startsWith("_scratch/");
const text = new Map();
for (const f of tracked) {
	if (!/\.(ts|tsx|mjs|mts|js|html|json|md|css)$/.test(f) || vendored(f)) continue;
	try {
		text.set(f, readFileSync(f, "utf8"));
	} catch {
		/* a symlink or a binary: not text */
	}
}
const entryPoints = new Set();
for (const f of tracked) {
	if (basename(f) !== "package.json" || f.includes("node_modules")) continue;
	const dir = f.slice(0, -"package.json".length);
	const { exports: ex } = JSON.parse(readFileSync(f, "utf8"));
	const targets = (value) => (typeof value === "string" ? [value] : value && typeof value === "object" ? Object.values(value).flatMap(targets) : []);
	for (const target of targets(ex)) if (target.startsWith("./")) entryPoints.add(dir + target.slice(2));
}
const isEntry = (f) => entryPoints.has(f) || /\/(index|public\/[\w-]+)\.tsx?$/.test(f) || f.startsWith("runtime/") || f.endsWith(".d.ts") || f.endsWith(".test-helper.ts");
// A module an entry point re-exports whole (`export * from "./routes.ts"`) is the API too, as far as its exports go.
for (let grew = true; grew; ) {
	grew = false;
	for (const [f, t] of text) {
		if (!isEntry(f)) continue;
		for (const m of t.matchAll(/^export \* from "(\.\.?\/[^"]+)";/gm)) {
			const target = new URL(m[1], `file:///${f}`).pathname.slice(1);
			if (!entryPoints.has(target) && text.has(target)) {
				entryPoints.add(target);
				grew = true;
			}
		}
	}
}
const decl = /^export\s+(?:async\s+)?(function\*?|const|let|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm;
const dead = [];
const testsOnly = [];
for (const [f, t] of text) {
	if (!/\.(ts|tsx|mjs|mts)$/.test(f) || /\.test\.(ts|mjs)$/.test(f) || isEntry(f)) continue;
	for (const m of t.matchAll(decl)) {
		const name = m[2];
		const word = new RegExp(`(?<![\\w$])${name.replace(/\$/g, "\\$")}(?![\\w$])`);
		let elsewhere = false;
		let tests = false;
		for (const [g, u] of text) {
			if (g === f || !word.test(u)) continue;
			if (/\.test\.(ts|mjs)$/.test(g) || g.endsWith(".md")) tests = true;
			else {
				elsewhere = true;
				break;
			}
		}
		if (elsewhere) continue;
		// Used in its own file more than once (the declaration counts once): exported for nothing, but not dead.
		const own = t.match(new RegExp(word.source, "g"))?.length ?? 0;
		if (own > 1) continue;
		(tests ? testsOnly : dead).push(`${f}: ${m[1]} ${name}`);
	}
}
if (dead.length) {
	console.log(`${dead.length} export(s) nothing references:`);
	for (const line of dead) console.log(`  ${line}`);
}
if (all && testsOnly.length) {
	console.log(`${testsOnly.length} export(s) only a test or a doc references:`);
	for (const line of testsOnly) console.log(`  ${line}`);
}
if (!dead.length) console.log("no dead exports");
process.exit(dead.length ? 1 : 0);
