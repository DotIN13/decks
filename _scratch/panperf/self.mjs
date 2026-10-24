// exclusive (self) time by event name on one thread
import { readFileSync } from "node:fs";
const t = JSON.parse(readFileSync(process.argv[2], "utf8")); const ev = t.traceEvents ?? t;
const want = process.argv[3] ?? "CrRendererMain";
const tname = {}; for (const e of ev) if (e.name === "thread_name") tname[e.pid + ":" + e.tid] = e.args.name;
const groups = {};
for (const e of ev) if (e.ph === "X" && e.dur && tname[e.pid + ":" + e.tid] === want) (groups[e.pid + ":" + e.tid] ??= []).push(e);
for (const [k, list] of Object.entries(groups)) {
  list.sort((a, b) => a.ts - b.ts || b.dur - a.dur);
  const self = {}; const stack = [];
  for (const e of list) {
    while (stack.length && stack.at(-1).ts + stack.at(-1).dur <= e.ts) stack.pop();
    if (stack.length) { const p = stack.at(-1); self[p.name] = (self[p.name] ?? 0) - e.dur; }
    self[e.name] = (self[e.name] ?? 0) + e.dur; stack.push(e);
  }
  const tot = Object.values(self).reduce((a, b) => a + b, 0);
  if (tot < 20000) continue;
  console.log("==", k, (tot / 1000).toFixed(0), "ms");
  for (const [n, d] of Object.entries(self).sort((a, b) => b[1] - a[1]).slice(0, 18)) console.log((d / 1000).toFixed(1).padStart(8), n);
}
