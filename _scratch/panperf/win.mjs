import { readFileSync } from "node:fs";
const t = JSON.parse(readFileSync(process.argv[2], "utf8")); const ev = t.traceEvents ?? t;
const [from, to, min] = process.argv.slice(3).map(Number);
const tname = {}, pname = {}; for (const e of ev) { if (e.name === "thread_name") tname[e.pid + ":" + e.tid] = e.args.name; if (e.name === "process_name") pname[e.pid] = e.args.name; }
let t0 = Infinity; for (const e of ev) if (e.ts > 0 && e.ts < t0) t0 = e.ts;
const rows = ev.filter((e) => e.ph === "X" && e.dur >= (min ?? 2) * 1000 && (e.ts - t0) / 1000 >= from && (e.ts - t0) / 1000 <= to && !/^(RunTask|ThreadControllerImpl::RunTask|ThreadPool_RunTask|Scheduler::RunTask|Graphics.Pipeline)$/.test(e.name));
rows.sort((a, b) => a.ts - b.ts);
for (const e of rows) console.log(((e.ts - t0) / 1000).toFixed(1).padStart(8), (e.dur / 1000).toFixed(1).padStart(6), `${pname[e.pid]}/${tname[e.pid + ":" + e.tid]}`.padEnd(40), e.name, e.args?.data?.functionName ?? "", e.args?.data?.url?.slice(-30) ?? "");
