#!/usr/bin/env node
/**
 * Class names a stylesheet styles and no markup writes: a gate beside `css-order.mjs`.
 *
 *     node scripts/dead-css.mjs        # exit 1, naming each class by the sheet that styles it
 *
 * Every `.class` in the app's and the packages' own sheets (comments stripped) is looked for, as a
 * whole word, in every tracked `.ts`, `.tsx`, `.html`, `.mjs` and `.js` outside the vendored libraries.
 * A class built in code from a stem (`\`pill-${kind}\``) counts as written when its stem followed by a
 * hyphen is quoted somewhere. Icon classes (`lucide-*`) come from the icon library's own SVGs.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
const vendored = (f) => /\/(lib|vendor|pkg|pkg-gl)\//.test(f) || /\.bundle\.|\.min\./.test(f) || f.startsWith("_scratch/") || f.startsWith("e2e/fixture/");
const sheets = tracked.filter((f) => f.endsWith(".css") && /^(apps\/web\/src|packages\/[\w-]+\/styles|packages\/ui\/src)\//.test(f));
const markup = tracked.filter((f) => /\.(ts|tsx|html|mjs|js)$/.test(f) && !vendored(f)).map((f) => readFileSync(f, "utf8")).join("\n");
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const written = (cls) => new RegExp(`(?<![\\w-])${escape(cls)}(?![\\w-])`).test(markup);
const builtFromStem = (cls) => {
	const at = cls.lastIndexOf("-");
	return at > 0 && new RegExp(`["'\`]${escape(cls.slice(0, at))}-["'\`$]`).test(markup);
};
const dead = new Map();
for (const sheet of sheets) {
	const css = readFileSync(sheet, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
	for (const cls of new Set([...css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]))) {
		if (cls.startsWith("lucide-") || written(cls) || builtFromStem(cls)) continue;
		if (!dead.has(sheet)) dead.set(sheet, []);
		dead.get(sheet).push(cls);
	}
}
let count = 0;
for (const [sheet, classes] of dead) {
	count += classes.length;
	console.log(`${sheet}: ${classes.sort().join(" ")}`);
}
console.log(count ? `${count} class(es) no markup writes` : "no dead classes");
process.exit(count ? 1 : 0);
