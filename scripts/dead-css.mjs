/**
 * The dead-CSS gate: a class declared in the app's or the packages' sheets that no markup writes is dead,
 * and this exits 1 naming it.
 *
 *     node scripts/dead-css.mjs
 *
 * Every `.class` token in the sheets (comments stripped) is looked for as a whole word in every tracked
 * `.ts`, `.tsx`, `.html` and `.mjs`, and a class whose `stem-` prefix is built in code (`stem-${…}`) is
 * taken as written. The `lucide-*` names are written into the SVGs by the icon library and are allowed.
 * A class a card's own HTML writes would be missed, which is why the check that found one is named in
 * `docs/REORGANIZATION.md` §3.4; none has been.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ALLOW = /^lucide-/;
const files = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean).filter((f) => !/(^|\/)(node_modules|dist|dist-packages)\//.test(f));
const sheets = files.filter((f) => /^(apps\/web\/src\/styles\/.*\.css|apps\/web\/src\/index\.css|packages\/(canvas|agent-ui|ui)\/styles\/.*\.css)$/.test(f));
const markup = files.filter((f) => /\.(ts|tsx|html|mjs)$/.test(f)).map((f) => readFileSync(f, "utf8")).join("\n");
const dead = [];
for (const sheet of sheets) {
	const css = readFileSync(sheet, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
	const classes = new Set([...css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]));
	for (const name of classes) {
		if (ALLOW.test(name) || new RegExp(`(?<![\\w-])${name}(?![\\w-])`).test(markup)) continue;
		const parts = name.split("-");
		let built = false;
		for (let i = parts.length - 1; i >= 1 && !built; i--) {
			const prefix = parts.slice(0, i).join("-") + "-";
			built = markup.includes(`${prefix}\${`) || markup.includes(`"${prefix}" +`) || markup.includes(`'${prefix}' +`);
		}
		if (!built) dead.push(`${sheet}: .${name}`);
	}
}
if (dead.length) {
	console.error(`${dead.length} classes no markup writes:`);
	for (const line of dead) console.error(`  ${line}`);
	process.exit(1);
}
console.log(`no dead classes over ${sheets.length} sheets`);
