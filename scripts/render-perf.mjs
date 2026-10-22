/**
 * Measure the stage on the 2,000-item `perf` canvas and print the numbers as one JSON object.
 *
 *   node scripts/render-perf.mjs            # ports 4651/4650, five runs of each measure
 *   RENDER_PERF_RUNS=9 node scripts/render-perf.mjs
 *
 * Runs `e2e/checks/render-perf.mjs` through the e2e runner (a fresh fixture deck and server of its
 * own), one job, then prints what it wrote. DECKS_E2E_API_PORT / DECKS_E2E_WEB_PORT move the ports.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "render-perf-"));
const out = join(dir, "render-perf.json");
const run = spawnSync(process.execPath, [join(root, "e2e", "run.mjs"), "render-perf"], {
	cwd: root,
	stdio: ["ignore", "inherit", "inherit"],
	env: { DECKS_E2E_API_PORT: "4651", DECKS_E2E_WEB_PORT: "4650", DECKS_E2E_VERBOSE: "1", DECKS_E2E_TAIL: "30", ...process.env, DECKS_E2E_JOBS: "1", RENDER_PERF_OUT: out },
});
if (!existsSync(out)) {
	console.error("render-perf: no numbers came back");
	rmSync(dir, { recursive: true, force: true });
	process.exit(run.status || 1);
}
const report = JSON.parse(readFileSync(out, "utf8"));
rmSync(dir, { recursive: true, force: true });
console.log(JSON.stringify(report, null, "\t"));
process.exit(run.status ?? 0);
