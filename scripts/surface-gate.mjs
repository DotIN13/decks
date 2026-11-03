/**
 * The surface gate: the canvas surface (`@decks/canvas`, `styles/surface.css`) is shared by the Decks app and
 * Decks Studio and themed by each, so it must not lean on either's styles, and neither may restyle it from
 * outside. Two checks:
 *
 * 1. The surface's sheets read no app token: every `var(--x)` is a canvas token (`--canvas-*`), a variable a
 *    surface sheet sets itself, or one the canvas's scripts set on an element (`RUNTIME`).
 * 2. The app's sheets select no surface class except the hooks the package lists (`styles/surface-hooks.json`):
 *    the places an app may hang its own parts or set the tokens. A rule that reaches past them is restyling the
 *    canvas, which is the tokens' job.
 *
 *     node scripts/surface-gate.mjs           # exit 1 and name each rule that breaks one
 */
import { readFileSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SURFACE = ["surface-tokens.css", "canvas.css", "ink.css", "marks.css", "host.css"].map((f) => join(ROOT, "packages/canvas/styles", f));
const APP_ENTRY = join(ROOT, "apps/web/src/index.css");
/** Set on elements by the canvas's scripts (`style.setProperty`, inline `--x`): the surface reads them, nobody themes them. */
const RUNTIME = new Set(["--u", "--act", "--zoom", "--read-ms", "--card-size", "--hit", "--cursor-color", "--inset-left", "--dock", "--frame-dock"]);
const hooks = JSON.parse(readFileSync(join(ROOT, "packages/canvas/styles/surface-hooks.json"), "utf8"));
const HOOKS = new Set(hooks.hooks.map((h) => h.class));

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ");
/** Every rule's selector list with its line, from a sheet's text (at-rule preludes skipped). */
function rules(text) {
	const out = [];
	const clean = strip(text);
	const re = /([^{};]+)\{/g;
	let m;
	while ((m = re.exec(clean))) {
		const sel = m[1].trim();
		if (!sel || sel.startsWith("@") || /^(from|to|\d+%)/.test(sel)) continue;
		out.push({ sel, line: clean.slice(0, m.index).split("\n").length });
	}
	return out;
}
/** The app's sheets: everything `index.css` imports from inside `apps/web`. */
function appSheets(entry) {
	const text = readFileSync(entry, "utf8");
	const files = [entry];
	for (const m of strip(text).matchAll(/@import\s+"([^"]+)"/g)) {
		if (!m[1].startsWith(".")) continue;
		const file = resolve(dirname(entry), m[1]);
		if (file.includes("/apps/web/")) files.push(file);
	}
	return files;
}

const problems = [];
// 1. The surface reads only its tokens.
const surfaceText = SURFACE.map((f) => readFileSync(f, "utf8")).join("\n");
const ownVars = new Set([...strip(surfaceText).matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
for (const file of SURFACE) {
	const text = strip(readFileSync(file, "utf8"));
	for (const m of text.matchAll(/var\((--[a-z0-9-]+)/g)) {
		const name = m[1];
		if (name.startsWith("--canvas-") || ownVars.has(name) || RUNTIME.has(name)) continue;
		problems.push(`${relative(ROOT, file)}:${text.slice(0, m.index).split("\n").length}  reads ${name}, an app's token: read a --canvas-* token instead`);
	}
}
// 2. The app's sheets keep off the surface's classes.
const surfaceClasses = new Set();
// The classes a surface selector starts from: its own parts. A name it only uses under one of them (`.bar-layer .title`)
// is not its, and an app may use the same name for its own thing.
/** A selector list split at its own commas, not those inside `:is(…)`. */
const listOf = (sel) => {
	const out = [];
	let depth = 0;
	let from = 0;
	for (let i = 0; i < sel.length; i++) {
		if (sel[i] === "(") depth++;
		else if (sel[i] === ")") depth--;
		else if (sel[i] === "," && depth === 0) {
			out.push(sel.slice(from, i));
			from = i + 1;
		}
	}
	return [...out, sel.slice(from)];
};
for (const file of SURFACE) for (const r of rules(readFileSync(file, "utf8"))) for (const one of listOf(r.sel)) {
	const first = one.trim().replace(/^:(?:where|is)\(([^)]*)\).*/, "$1").split(/[\s>+~]/)[0];
	for (const c of first.matchAll(/\.([a-zA-Z][\w-]*)/g)) surfaceClasses.add(c[1]);
}
for (const h of HOOKS) if (!surfaceClasses.has(h)) problems.push(`surface-hooks.json lists .${h}, which no surface sheet styles`);
for (const file of appSheets(APP_ENTRY)) {
	for (const r of rules(readFileSync(file, "utf8"))) {
		const reached = [...r.sel.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((c) => c[1]).filter((c) => surfaceClasses.has(c) && !HOOKS.has(c));
		if (reached.length) problems.push(`${relative(ROOT, file)}:${r.line}  ${r.sel.replace(/\s+/g, " ").slice(0, 90)}  reaches .${[...new Set(reached)].join(", .")}`);
	}
}
if (problems.length) {
	console.log(`${problems.length} rule${problems.length === 1 ? "" : "s"} cross the surface's line:\n  ${problems.join("\n  ")}`);
	process.exit(1);
}
console.log(`the surface reads only its tokens, and the app's ${appSheets(APP_ENTRY).length - 1} sheets keep to its ${HOOKS.size} hooks`);
