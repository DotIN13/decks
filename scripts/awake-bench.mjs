/**
 * Measure a pan and a zoom on a canvas heavy with cards, apps and documents, and print the numbers as JSON.
 *
 *   node scripts/awake-bench.mjs                 # ports 4681/4680, three runs of each
 *   AWAKE_BENCH_RUNS=5 node scripts/awake-bench.mjs
 *
 * Runs `e2e/checks/awake-bench.mjs` through the e2e runner (a fresh fixture deck and server of its own).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "awake-bench-"));
const out = join(dir, "awake-bench.json");
const run = spawnSync(process.execPath, [join(root, "e2e", "run.mjs"), "awake-bench"], {
	cwd: root,
	// The runner's own output on stderr, so stdout is the JSON alone.
	stdio: ["ignore", 2, 2],
	env: { DECKS_E2E_API_PORT: "4681", DECKS_E2E_WEB_PORT: "4680", DECKS_E2E_VERBOSE: "1", DECKS_E2E_TAIL: "30", ...process.env, DECKS_E2E_JOBS: "1", AWAKE_BENCH_OUT: out },
});
if (!existsSync(out)) {
	console.error("awake-bench: no numbers came back");
	rmSync(dir, { recursive: true, force: true });
	process.exit(run.status || 1);
}
const report = JSON.parse(readFileSync(out, "utf8"));
rmSync(dir, { recursive: true, force: true });
console.log(JSON.stringify(report, null, "\t"));
process.exit(run.status ?? 0);
