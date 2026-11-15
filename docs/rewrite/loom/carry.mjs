#!/usr/bin/env node
// Carries a split file's baseline keys to the files it became: node docs/rewrite/loom/carry.mjs <was> <file>... [--root <checkout>] [--dry]
// Stage the new files first (the gates read tracked files). Each key of these files is set to today's count and
// keys they no longer break go; it refuses, writing nothing, if any kind of exception would rise above what the
// files held at HEAD together. Then commit tools/gates/baseline/*.json by name, with the split.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { baselinePath, context, readBaseline, ROOT } from "../../../tools/gates/lib.mjs";
import { loadGates } from "../../../tools/gates/run.mjs";

const argv = process.argv.slice(2);
const rootAt = argv.indexOf("--root");
const root = rootAt >= 0 ? resolve(argv[rootAt + 1]) : ROOT;
const args = argv.filter((a, i) => !a.startsWith("--") && !(rootAt >= 0 && i === rootAt + 1));
const dry = process.argv.includes("--dry");
if (args.length < 1) throw new Error("usage: carry.mjs <was> <file>... [--dry]");
const files = new Set(args);

/** The file a key is about: its path, after any prefix such as "stale-paths: ". */
const fileOf = (key) => [...files].find((f) => key.startsWith(`${f}: `) || key.includes(`: ${f}: `));
/** The kind of exception a key counts, its file left out: "names: board", "size: over 1000 lines". */
const kindOf = (gate, key, file) => `${gate}: ${key.replace(`${file}: `, "").replace(/function \S+ over/, "function over")}`;

const atHead = (gate) => {
	try {
		return JSON.parse(execFileSync("git", ["show", `HEAD:tools/gates/baseline/${gate}.json`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
	} catch {
		return {};
	}
};

const ctx = context(root);
const writes = [];
const before = new Map();
const after = new Map();
const add = (map, kind, n) => map.set(kind, (map.get(kind) ?? 0) + n);
for (const gate of await loadGates()) {
	const { counts } = gate.scan(ctx);
	const old = readBaseline(root, gate.name);
	for (const [key, n] of Object.entries(atHead(gate.name))) {
		const file = fileOf(key);
		if (file) add(before, kindOf(gate.name, key, file), n);
	}
	const next = Object.fromEntries(Object.entries(old).filter(([key]) => !fileOf(key)));
	for (const [key, n] of counts) {
		const file = fileOf(key);
		if (!file) continue;
		next[key] = n;
		add(after, kindOf(gate.name, key, file), n);
	}
	const sorted = Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)));
	if (JSON.stringify(sorted) !== JSON.stringify(old)) writes.push([gate.name, sorted]);
}
const rose = [...after].filter(([kind, n]) => n > (before.get(kind) ?? 0));
for (const [kind, n] of after) console.log(`${kind}: ${before.get(kind) ?? 0} -> ${n}`);
if (rose.length) {
	console.error(`Not written: these rise above what the files held at HEAD: ${rose.map(([k, n]) => `${k} (${n}, was ${before.get(k) ?? 0})`).join("; ")}`);
	process.exit(1);
}
for (const [gate, next] of writes) {
	console.log(`${dry ? "would write" : "wrote"} tools/gates/baseline/${gate}.json`);
	if (!dry) writeFileSync(baselinePath(root, gate), `${JSON.stringify(next, null, "\t")}\n`);
}
