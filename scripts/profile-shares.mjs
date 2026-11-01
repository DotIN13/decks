#!/usr/bin/env node
/**
 * Where a CPU profile's time went, by share: a `.cpuprofile` (CDP `Profiler.stop`, as `awake-bench.mjs`
 * writes with AWAKE_BENCH_PROFILE) summed by self time into a few buckets, then the top functions.
 *
 *   node scripts/profile-shares.mjs /tmp/zoom.cpuprofile [--top 25]
 *
 * Buckets: the engine's wasm (the Rust page engine), engine.ts (the TypeScript round it), each other
 * source file over 1%, the browser's own (garbage collector, program, idle), and anything else.
 */
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) throw new Error("profile-shares: give a .cpuprofile");
const topN = Number(process.argv[process.argv.indexOf("--top") + 1] || 25);
const profile = JSON.parse(readFileSync(file, "utf8"));
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
// Self time per node: the time deltas of the samples that landed on it.
const deltas = profile.timeDeltas;
for (let i = 0; i < profile.samples.length; i++) self.set(profile.samples[i], (self.get(profile.samples[i]) ?? 0) + (deltas[i + 1] ?? 0));
const total = [...self.values()].reduce((a, b) => a + b, 0);
const idle = (n) => n.callFrame.functionName === "(idle)";
const busy = profile.nodes.filter((n) => !idle(n)).reduce((a, n) => a + (self.get(n.id) ?? 0), 0);

const name = (n) => {
	const f = n.callFrame;
	const url = f.url.replace(/^.*\//, "").replace(/\?.*$/, "");
	return `${f.functionName || "(anonymous)"} ${url}${f.lineNumber >= 0 ? ":" + (f.lineNumber + 1) : ""}`;
};
const bucket = (n) => {
	const f = n.callFrame;
	if (f.functionName === "(garbage collector)") return "GC";
	if (f.functionName === "(program)") return "(program)";
	if (f.functionName === "(idle)") return "(idle)";
	if (f.url.startsWith("wasm://") || f.url.includes("stage_web") || f.functionName.startsWith("wasm-function")) return "engine wasm";
	const url = f.url.replace(/\?.*$/, "");
	const m = url.match(/\/src\/(.*)$/);
	if (m) return m[1];
	if (url.includes("node_modules")) return "node_modules/" + (url.match(/node_modules\/(?:\.vite\/deps\/)?([^/]+)/)?.[1] ?? "?");
	return url ? url.replace(/^.*\//, "") : "(native)";
};
const buckets = new Map();
for (const n of profile.nodes) {
	const t = self.get(n.id) ?? 0;
  if (!t) continue;
	const b = bucket(n);
	buckets.set(b, (buckets.get(b) ?? 0) + t);
}
// Also by caller chain: wasm time called from which engine.ts method (the first engine.ts frame up the stack).
const parentOf = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parentOf.set(c, n.id);
const viaEngine = new Map();
for (const n of profile.nodes) {
	const t = self.get(n.id) ?? 0;
	if (!t || bucket(n) !== "engine wasm") continue;
	let p = n.id;
	let via = "(none)";
	while (p !== undefined) {
		const node = byId.get(p);
		if (node.callFrame.url.includes("engine.ts") || node.callFrame.url.includes("stage_web.js")) {
			if (node.callFrame.url.includes("engine.ts")) { via = node.callFrame.functionName; break; }
		}
		p = parentOf.get(p);
	}
	viaEngine.set(via, (viaEngine.get(via) ?? 0) + t);
}
const pct = (t, of = busy) => `${((100 * t) / of).toFixed(1).padStart(5)}%`;
const ms = (t) => `${(t / 1000).toFixed(1).padStart(8)} ms`;
console.log(`total ${ms(total)}, busy ${ms(busy)} (${pct(busy, total)} of wall)\n`);
console.log("by bucket (share of busy time):");
for (const [b, t] of [...buckets].sort((a, b) => b[1] - a[1])) if (b !== "(idle)" && t / busy >= 0.005) console.log(`  ${pct(t)} ${ms(t)}  ${b}`);
console.log("\nengine wasm, by the engine.ts method that called it:");
for (const [b, t] of [...viaEngine].sort((a, b) => b[1] - a[1])) console.log(`  ${pct(t)} ${ms(t)}  ${b}`);
console.log(`\ntop ${topN} functions by self time:`);
const fns = new Map();
for (const n of profile.nodes) {
	const t = self.get(n.id) ?? 0;
	if (!t || idle(n)) continue;
	const k = name(n);
	fns.set(k, (fns.get(k) ?? 0) + t);
}
for (const [k, t] of [...fns].sort((a, b) => b[1] - a[1]).slice(0, topN)) console.log(`  ${pct(t)} ${ms(t)}  ${k}`);
