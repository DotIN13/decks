/**
 * Measure panning on canvases heavy with cards and drawing, and print the numbers as one JSON object.
 *
 *   node scripts/pan-heavy.mjs            # ports 4671/4670, five runs of each measure
 *   PAN_HEAVY_RUNS=9 node scripts/pan-heavy.mjs
 *
 * Runs `e2e/checks/pan-heavy.mjs` through the e2e runner (a fresh fixture deck and server of its
 * own), one job, then prints what it wrote. DECKS_E2E_API_PORT / DECKS_E2E_WEB_PORT move the ports.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "pan-heavy-"));
const out = join(dir, "pan-heavy.json");
const run = spawnSync(process.execPath, [join(root, "e2e", "run.mjs"), "pan-heavy"], {
	cwd: root,
	stdio: ["ignore", "inherit", "inherit"],
	env: { DECKS_E2E_API_PORT: "4671", DECKS_E2E_WEB_PORT: "4670", DECKS_E2E_VERBOSE: "1", DECKS_E2E_TAIL: "30", ...process.env, DECKS_E2E_JOBS: "1", PAN_HEAVY_OUT: out },
});
if (!existsSync(out)) {
	console.error("pan-heavy: no numbers came back");
	rmSync(dir, { recursive: true, force: true });
	process.exit(run.status || 1);
}
const report = JSON.parse(readFileSync(out, "utf8"));
rmSync(dir, { recursive: true, force: true });
console.log(JSON.stringify(report, null, "\t"));
process.exit(run.status ?? 0);
