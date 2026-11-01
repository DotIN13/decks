#!/usr/bin/env node
/**
 * What allocated, from a sampling heap profile (CDP `HeapProfiler.stopSampling`, as `awake-bench.mjs` writes with
 * AWAKE_BENCH_ALLOC): bytes by the function that allocated them (self), and by the first function up the stack
 * in the engine's own code.
 *
 *   node scripts/alloc-shares.mjs /tmp/zoom.heapprofile [--top 25]
 */
import { readFileSync } from "node:fs";
const file = process.argv[2];
if (!file) throw new Error("alloc-shares: give a heap profile");
const topN = Number(process.argv[process.argv.indexOf("--top") + 1] || 25);
const profile = JSON.parse(readFileSync(file, "utf8"));
const name = (f) => `${f.functionName || "(anonymous)"} ${(f.url || "").replace(/^.*\//, "").replace(/\?.*$/, "")}${f.lineNumber >= 0 ? ":" + (f.lineNumber + 1) : ""}`;
const self = new Map();
const owner = new Map();
let total = 0;
const walk = (node, chain) => {
	const here = [...chain, node.callFrame];
	if (node.selfSize) {
		total += node.selfSize;
		const k = name(node.callFrame);
		self.set(k, (self.get(k) ?? 0) + node.selfSize);
		const ours = [...here].reverse().find((f) => /\/src\/|engine|stage|items|camera/.test(f.url || "") && !/node_modules/.test(f.url || ""));
		const o = ours ? name(ours) : "(no engine frame)";
		owner.set(o, (owner.get(o) ?? 0) + node.selfSize);
	}
	for (const c of node.children ?? []) walk(c, here);
};
walk(profile.head, []);
const mb = (b) => `${(b / 1048576).toFixed(1).padStart(7)} MB`;
const pct = (b) => `${((100 * b) / total).toFixed(1).padStart(5)}%`;
console.log(`sampled allocations: ${mb(total)}\n\nby our function up the stack:`);
for (const [k, b] of [...owner].sort((a, b) => b[1] - a[1]).slice(0, topN)) console.log(`  ${pct(b)} ${mb(b)}  ${k}`);
console.log(`\nby allocating function:`);
for (const [k, b] of [...self].sort((a, b) => b[1] - a[1]).slice(0, topN)) console.log(`  ${pct(b)} ${mb(b)}  ${k}`);
