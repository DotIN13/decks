/**
 * The stage engine draws its fixtures alike under Chromium WebGPU, Chromium WebGL 2 and WebKit
 * (iPhone 15 Pro) WebGL 2, and each matches its native golden: `apps/web/scripts/stage-backends.ts`
 * (`npm run stage:backends` in apps/web), run as one check. It needs no deck: it draws the committed
 * `packages/stage/pkg*` builds on a throwaway server of its own. One PASS/FAIL line per backend and
 * per pair of backends, from the script's own lines.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { say } from "../harness.mjs";

const web = join(dirname(fileURLToPath(import.meta.url)), "../../apps/web");
// The fonts the fixtures set words in, fetched when missing (`packages/stage/fetch-fonts.mjs`): without them the fixtures with words are not drawn at all.
const fonts = spawnSync(process.execPath, ["fetch-fonts.mjs"], { cwd: join(web, "../../packages/stage"), encoding: "utf8", timeout: 120000 });
say("the fixtures' fonts are here", fonts.status === 0, `${fonts.stdout ?? ""}${fonts.stderr ?? ""}`.trim().split("\n").at(-1));
const run = spawnSync(process.execPath, ["--import", "tsx", "scripts/stage-backends.ts"], { cwd: web, encoding: "utf8", timeout: 120000 });
const out = `${run.stdout ?? ""}${run.stderr ?? ""}`;
const lines = out.split("\n");
// A backend's block: its header, then its fixtures' ✓/✗ lines.
let target = null;
const blocks = [];
for (const line of lines) {
	if (/^\S.*: (webgpu|webgl2), /.test(line)) blocks.push((target = { head: line, bad: [], good: 0 }));
	else if (target && /^ {2}✗/.test(line)) target.bad.push(line.trim());
	else if (target && /^ {2}✓/.test(line)) target.good++;
	else if (/^[✓✗] .* vs /.test(line)) say(`backends alike: ${line.slice(2)}`, line.startsWith("✓"));
}
for (const b of blocks) say(`${b.head}: ${b.good} fixtures match their goldens`, b.bad.length === 0 && b.good > 0, b.bad.join(" | "));
say("stage-backends exits cleanly with three backends", run.status === 0 && blocks.length === 3, run.status === 0 ? "" : out.slice(-1500));
