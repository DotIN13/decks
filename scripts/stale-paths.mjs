/**
 * The stale-pointer gate: a comment or a doc that names a source file (`render/engine.ts`) with no file of
 * that name anywhere in the tree points a reader at nothing, and this exits 1 naming it.
 *
 *     node scripts/stale-paths.mjs
 *
 * Every backticked `name.ext` (ts, tsx, mjs, mts, css, rs) in a tracked text file is looked up by its
 * basename among the tracked files. A name in a file that tells history on purpose (the browser checks
 * cut from the suite, in `e2e/README.md` and `run.mjs`) or that names another project's file (`HISTORY`)
 * is allowed; add a file there only for the same reason. Data files (`deck.json`) are not source and
 * are not checked.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** Files whose vanished names are history or another project's, told as such. */
const HISTORY = new Set([
	"e2e/README.md", "e2e/run.mjs", "e2e/harness.mjs", "e2e/checks/context.mjs",
	"apps/web/src/lib/media.ts", "runtime/paths.ts", "apps/server/src/browser/bridge.test.ts", "packages/canvas/styles/canvas.css",
	"scripts/css-order.test.mjs", "packages/agent-ui/src/alerts/policy.ts", "packages/agent-ui/styles/stream.css",
	"docs/REORGANIZATION.md", "docs/COMPAT.md",
]);
const files = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean)
	.filter((f) => !/(^|\/)(node_modules|dist|dist-packages|pkg|pkg-gl)\//.test(f) && !/\.bundle\./.test(f) && !/^docs\/archive\//.test(f));
const basenames = new Set(files.map((f) => f.split("/").pop()));
const stale = [];
for (const f of files) {
	if (!/\.(ts|tsx|mjs|mts|md|css|rs|yml|html)$/.test(f) || HISTORY.has(f) || /cascade-order\.json$/.test(f)) continue;
	const lines = readFileSync(f, "utf8").split("\n");
	lines.forEach((line, i) => {
		for (const m of line.matchAll(/`((?:\.\.?\/)*[\w-][\w./-]*\.(?:ts|tsx|mjs|mts|css|rs))`/g)) if (!basenames.has(m[1].split("/").pop())) stale.push(`${f}:${i + 1}: ${m[1]}`);
	});
}
if (stale.length) {
	console.error(`${stale.length} names of files that do not exist:`);
	for (const line of stale) console.error(`  ${line}`);
	process.exit(1);
}
console.log(`no stale file names in ${files.length} files`);
