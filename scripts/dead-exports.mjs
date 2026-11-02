/**
 * The dead-export gate: an exported symbol nothing else references is dead, and this exits 1 naming it.
 *
 *     node scripts/dead-exports.mjs            # exit 1 naming each dead export
 *     node scripts/dead-exports.mjs --over     # also list exports used only in their own file (information, not a failure)
 *
 * For every `export function|const|let|class|interface|type|enum Name` in a tracked source file, the whole
 * word `Name` is counted in every other tracked text file. Zero elsewhere and one at home is dead. Zero
 * elsewhere and more at home is over-exported: not dead, but a wider surface than the module has, and
 * `--over` lists those so a package can drop the keyword in one pass.
 *
 * Not counted: the package entry points (`index.ts`, `public/*.ts`), where an export is the API whether
 * or not this repository reads it; `.d.ts` files; and the two modules a committed bundle or a plugin
 * loader is the only reader of (`ALLOW`). Vendored `lib/` folders, bundles and build output are not
 * scanned. The scan is by name, so a symbol that shares its name with another is never reported dead.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ALLOW = new Set(["runtime/live-doc.ts", "runtime/opencode/plugin/decks-session.ts"]);
const over = process.argv.includes("--over");
const files = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean)
	.filter((f) => !/(^|\/)(node_modules|dist|dist-packages|pkg|pkg-gl|target)\//.test(f) && !/\.bundle\./.test(f) && !/^(packages\/card-host\/lib|runtime\/lib)\//.test(f));
const text = new Map();
for (const f of files) if (/\.(ts|tsx|mjs|mts|js|html|json|md|css|rs|wgsl)$/.test(f)) text.set(f, readFileSync(f, "utf8"));
const isEntry = (f) => /(^|\/)(index\.tsx?|public\/[^/]+\.tsx?)$/.test(f) || /\.d\.ts$/.test(f) || ALLOW.has(f);
const declaration = /^export\s+(?:async\s+)?(?:declare\s+)?(?:function\*?|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm;
const dead = [];
const overExported = [];
for (const [f, t] of text) {
	if (!/\.(ts|tsx|mjs|mts)$/.test(f) || isEntry(f)) continue;
	for (const m of t.matchAll(declaration)) {
		const name = m[1];
		const word = new RegExp(`(?<![\\w$])${name.replace(/\$/g, "\\$")}(?![\\w$])`, "g");
		let elsewhere = 0;
		for (const [g, gt] of text) if (g !== f && word.test(gt)) { elsewhere++; break; }
		if (elsewhere) continue;
		const home = (t.match(word) || []).length;
		(home === 1 ? dead : overExported).push(`${f}: ${name}`);
	}
}
if (over) {
	console.log(`${overExported.length} exported but used only in their own file:`);
	for (const line of overExported) console.log(`  ${line}`);
}
if (dead.length) {
	console.error(`${dead.length} exported and referenced nowhere:`);
	for (const line of dead) console.error(`  ${line}`);
	process.exit(1);
}
console.log(`no dead exports (${overExported.length} over-exported; --over lists them)`);
