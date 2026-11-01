#!/usr/bin/env node
/**
 * Where the renderer's main thread went in a Chrome trace, by share: the trace `awake-bench.mjs` writes
 * with AWAKE_BENCH_TRACE, summed by self time per timeline event name on the busiest renderer thread.
 *
 *   node scripts/trace-shares.mjs /tmp/zoom-trace.json
 */
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) throw new Error("trace-shares: give a trace file");
const { traceEvents } = JSON.parse(readFileSync(file, "utf8"));
// Complete events ("X") with a duration, by thread: the main thread is the one with the most time in RunTask.
const byThread = new Map();
for (const e of traceEvents) {
	if (e.ph !== "X" || !(e.dur > 0)) continue;
	const key = `${e.pid}:${e.tid}`;
	if (!byThread.has(key)) byThread.set(key, []);
	byThread.get(key).push(e);
}
let main;
let most = -1;
for (const [key, list] of byThread) {
	const tasks = list.filter((e) => e.name === "RunTask" || e.name === "ThreadControllerImpl::RunTask").reduce((a, e) => a + e.dur, 0);
	if (tasks > most) { most = tasks; main = key; }
}
const events = byThread.get(main).sort((a, b) => a.ts - b.ts || b.dur - a.dur);
// Self time: an event's duration less its children's. Nested by a stack walk over the sorted list.
const self = new Map();
const stack = [];
let busy = 0;
const wall = events.length ? events[events.length - 1].ts + events[events.length - 1].dur - events[0].ts : 0;
for (const e of events) {
	while (stack.length && stack[stack.length - 1].ts + stack[stack.length - 1].dur <= e.ts) stack.pop();
	const parent = stack[stack.length - 1];
	if (parent) self.set(parent.name, (self.get(parent.name) ?? 0) - e.dur);
	else busy += e.dur;
	self.set(e.name, (self.get(e.name) ?? 0) + e.dur);
	stack.push(e);
}
const ms = (t) => `${(t / 1000).toFixed(1).padStart(8)} ms`;
console.log(`thread ${main}: wall ${ms(wall)}, in tasks ${ms(busy)} (${((100 * busy) / wall).toFixed(0)}%)\n`);
console.log("self time by event (share of task time):");
for (const [name, t] of [...self].sort((a, b) => b[1] - a[1])) if (t / busy >= 0.003) console.log(`  ${((100 * t) / busy).toFixed(1).padStart(5)}% ${ms(t)}  ${name}`);
// FunctionCall and friends by the script they name, where the trace says.
const fn = new Map();
for (const e of events) if ((e.name === "FunctionCall" || e.name === "TimerFire" || e.name === "EventDispatch") && e.args?.data) { const d = e.args.data; const k = `${e.name} ${d.functionName ?? d.type ?? ""} ${(d.url ?? "").replace(/^.*\//, "").replace(/\?.*/, "")}`; fn.set(k, (fn.get(k) ?? 0) + e.dur); }
console.log("\ntop tasks by what the browser says ran (total time, children included):");
for (const [k, t] of [...fn].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${ms(t)}  ${k}`);
