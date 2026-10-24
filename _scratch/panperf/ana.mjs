import { readFileSync } from "node:fs";
const t = JSON.parse(readFileSync(process.argv[2], "utf8"));
const ev = t.traceEvents ?? t;
const tname = {}, pname = {};
for (const e of ev) { if (e.name === "thread_name") tname[e.pid + ":" + e.tid] = e.args.name; if (e.name === "process_name") pname[e.pid] = e.args.name; }
// window: from first to last wheel-dispatch-ish; use whole trace
const X = ev.filter((e) => e.ph === "X" && e.dur);
const t0 = Math.min(...X.map((e) => e.ts)), t1 = Math.max(...X.map((e) => e.ts + e.dur));
console.log("span ms", ((t1 - t0) / 1000).toFixed(0));
// busy per thread: union of top-level X intervals
const by = {};
for (const e of X) { const k = e.pid + ":" + e.tid; (by[k] ??= []).push(e); }
const rows = [];
for (const [k, list] of Object.entries(by)) {
	list.sort((a, b) => a.ts - b.ts);
	let busy = 0, end = -1;
	for (const e of list) { const s = Math.max(e.ts, end); const f = e.ts + e.dur; if (f > s) { busy += f - s; } end = Math.max(end, f); }
	const names = {};
	for (const e of list) names[e.name] = (names[e.name] ?? 0) + e.dur;
	const top = Object.entries(names).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, d]) => `${n}:${(d / 1000).toFixed(0)}`).join(" ");
	rows.push({ thread: `${pname[k.split(":")[0]] ?? "?"}/${tname[k] ?? k}`, busy: busy / 1000, top });
}
rows.sort((a, b) => b.busy - a.busy);
for (const r of rows.slice(0, 12)) console.log(r.busy.toFixed(0).padStart(6), r.thread, "\n        ", r.top);
// frames
const pr = ev.filter((e) => e.name === "PipelineReporter" && e.ph === "b");
const states = {};
for (const e of pr) { const s = e.args?.chrome_frame_reporter?.state ?? "?"; states[s] = (states[s] ?? 0) + 1; }
console.log("PipelineReporter states", states);
