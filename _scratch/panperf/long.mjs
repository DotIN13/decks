import { readFileSync } from "node:fs";
const t = JSON.parse(readFileSync(process.argv[2], "utf8")); const ev = t.traceEvents ?? t;
const tname = {}, pname = {}; for (const e of ev) { if (e.name === "thread_name") tname[e.pid + ":" + e.tid] = e.args.name; if (e.name === "process_name") pname[e.pid] = e.args.name; }
const min = Number(process.argv[3] ?? 25) * 1000;
const X = ev.filter((e) => e.ph === "X" && e.dur > min && /RunTask|ThreadPool_RunTask|ThreadControllerImpl::RunTask/.test(e.name));
let t0 = Infinity; for (const e of ev) if (e.ts > 0 && e.ts < t0) t0 = e.ts;
const seen = new Set();
for (const e of X.sort((a,b)=>a.ts-b.ts)) {
  const k = e.pid+":"+e.tid; const key = k+":"+e.ts; if (seen.has(key)) continue; seen.add(key);
  // children breakdown: direct-ish nested events with largest dur
  const kids = ev.filter((c) => c.ph === "X" && c.pid === e.pid && c.tid === e.tid && c.ts >= e.ts && c.ts + c.dur <= e.ts + e.dur && c !== e && c.dur > e.dur * 0.08 && !/RunTask/.test(c.name));
  console.log(((e.ts - t0) / 1000).toFixed(0).padStart(6), (e.dur / 1000).toFixed(1).padStart(6), `${pname[e.pid]}/${tname[k]}`, kids.slice(0, 10).map((c) => `${c.name}${c.args?.data?.url ? "[" + c.args.data.url.slice(-40) + "]" : ""}${c.args?.data?.functionName ? "(" + c.args.data.functionName + ")" : ""}:${(c.dur / 1000).toFixed(1)}`).join(" | "));
}
