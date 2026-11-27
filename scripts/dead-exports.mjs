/**
 * The dead-export gate: an exported symbol nothing else references is dead, and this exits 1 naming it.
 *
 *     node scripts/dead-exports.mjs            # exit 1 naming each dead export
 *     node scripts/dead-exports.mjs --over     # also list exports used only in their own file (information, not a failure)
 *
 * For every `export function|const|let|class|interface|type|enum Name` in a tracked source file, the whole
 * word `Name` is counted in every other tracked file, with comments taken out of code and Markdown left
 * out: a comment or a doc naming a symbol is not a use of it. A symbol only tests use is "test-only": the
 * app does not run it. Those are held to a count that may only fall (`scripts/dead-exports-baseline.json`,
 * `--update` to lower it): panel-groups.ts lived on that way, kept alive by its test and the comments that
 * still described it. Zero elsewhere and one at home is dead. Zero
 * elsewhere and more at home is over-exported: not dead, but a wider surface than the module has, and
 * `--over` lists those so a package can drop the keyword in one pass.
 *
 * Not counted: the package entry points (`index.ts`, `public/*.ts`), where an export is the API whether
 * or not this repository reads it; `.d.ts` files; and the two modules a committed bundle or a plugin
 * loader is the only reader of (`ALLOW`). Vendored `lib/` folders, bundles and build output are not
 * scanned. The scan is by name, so a symbol that shares its name with another is never reported dead.
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const ALLOW = new Set(["runtime/live-doc.ts", "runtime/opencode/plugin/decks-session.ts"]);
const over = process.argv.includes("--over");
const update = process.argv.includes("--update");
const files = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean)
	.filter((f) => !/(^|\/)(node_modules|dist|dist-packages|pkg|pkg-gl|target)\//.test(f) && !/\.bundle\./.test(f) && !/^(packages\/card-host\/lib|runtime\/lib)\//.test(f));
const text = new Map();
for (const f of files) if (/\.(ts|tsx|mjs|mts|js|html|json|md|css|rs|wgsl)$/.test(f)) text.set(f, readFileSync(f, "utf8"));
const isEntry = (f) => /(^|\/)(index\.tsx?|public\/[^/]+\.tsx?)$/.test(f) || /\.d\.ts$/.test(f) || ALLOW.has(f);
const declaration = /^export\s+(?:async\s+)?(?:declare\s+)?(?:function\*?|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm;
const isTest = (f) => /(^|\/)(e2e|tests?)\/|\.(test|check)\.[mc]?[jt]sx?$|\.test-helper\.ts$/.test(f);
const uncommented = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\"'`])\/\/[^\n]*/g, "$1");
/** Each file's text as it counts for a use: code without its comments; never Markdown. */
const counted = new Map();
for (const [f, t] of text) if (!f.endsWith(".md")) counted.set(f, /\.(ts|tsx|mjs|mts|js)$/.test(f) ? uncommented(t) : t);
const dead = [];
const testOnly = [];
const overExported = [];
for (const [f, t] of text) {
	if (!/\.(ts|tsx|mjs|mts)$/.test(f) || isEntry(f) || isTest(f)) continue;
	for (const m of t.matchAll(declaration)) {
		const name = m[1];
		const word = new RegExp(`(?<![\\w$])${name.replace(/\$/g, "\\$")}(?![\\w$])`, "g");
		let inCode = false;
		let inTests = false;
		for (const [g, gt] of counted) {
			if (g === f || !word.test(gt)) continue;
			if (isTest(g)) inTests = true;
			else { inCode = true; break; }
		}
		if (inCode) continue;
		if (inTests) { testOnly.push(`${f}: ${name}`); continue; }
		const home = (t.match(word) || []).length;
		(home === 1 ? dead : overExported).push(`${f}: ${name}`);
	}
}
if (over) {
	console.log(`${overExported.length} exported but used only in their own file:`);
	for (const line of overExported) console.log(`  ${line}`);
}
const baselineFile = new URL("./dead-exports-baseline.json", import.meta.url);
let baseline = Infinity;
try { baseline = JSON.parse(readFileSync(baselineFile, "utf8")).testOnly; } catch {}
if (update) {
	writeFileSync(baselineFile, JSON.stringify({ testOnly: testOnly.length }, null, "\t") + "\n");
	console.log(`test-only exports held at ${testOnly.length}`);
}
if (over || testOnly.length > baseline) {
	console.log(`${testOnly.length} exported but used only by tests (the baseline holds ${baseline}):`);
	for (const line of testOnly) console.log(`  ${line}`);
}
if (testOnly.length > baseline) {
	console.error(`${testOnly.length - baseline} more export(s) used only by tests than the baseline: use them, delete them, or keep them out of the export list.`);
	process.exit(1);
}
if (dead.length) {
	console.error(`${dead.length} exported and referenced nowhere:`);
	for (const line of dead) console.error(`  ${line}`);
	process.exit(1);
}
console.log(`no dead exports (${overExported.length} over-exported; --over lists them)`);
