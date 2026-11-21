/**
 * The i18n gate: every word a person reads is a message, in every language Decks speaks.
 *
 *     node scripts/i18n-gate.mjs            # exit 1 when a language is incomplete or bare English grew
 *     node scripts/i18n-gate.mjs --report   # list every bare English word left, by file
 *     node scripts/i18n-gate.mjs --update   # write the baseline from the code as it is (after an improvement)
 *
 * Two things are held.
 *
 * **The messages** (`packages/i18n`, `compile.mjs --check`): each language has every message, with the
 * same placeholders, and the compiled functions are what the messages compile to.
 *
 * **Bare English in the page's code**: text between JSX tags, and the `title`, `placeholder`,
 * `aria-label` and `alt` a person reads, written as English in a `.tsx` file of the packages that draw
 * the page. Names (Decks, Claude, Chrome, …), symbols and single letters are not words to translate. The
 * count per file is held in `scripts/i18n-baseline.json` and may only fall, so new code writes messages
 * and what is left is listed for whoever moves it next.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = join(root, "scripts", "i18n-baseline.json");
const DIRS = ["apps/web/src", "packages/canvas/src", "packages/agent-ui/src", "packages/ui/src", "packages/docs/src", "packages/card-host/src"];
const READ = new Set(["title", "placeholder", "aria-label", "alt"]);
/** Words that stay as they are in every language. */
const NAMES = new Set(["Decks", "Claude", "Claude Code", "Chrome", "Studio", "Decks Studio", "Pen", "pen.dev", "MCP", "GitHub", "Google", "Safari", "iPad", "iPhone", "Mac", "macOS", "Opus", "Sonnet", "Haiku", "Fable", "DeepSeek", "OpenCode", "Pi", "Tailscale", "Whisper", "LaTeX", "PDF", "PNG", "JPEG", "SVG", "HTML", "CSS", "JSON", "Markdown", "URL", "API", "ID", "OK", "px", "fps", "ms", "UTC"]);

function files(dir) {
	const out = [];
	if (!existsSync(dir)) return out;
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) out.push(...files(path));
		else if (name.endsWith(".tsx") && !name.includes(".test.")) out.push(path);
	}
	return out;
}

/** Is this a word a person would want in their language? */
function english(text) {
	const words = text.replace(/\s+/g, " ").trim();
	if (!/[A-Za-z]{2,}/.test(words)) return false;
	if (NAMES.has(words)) return false;
	// Every word a name, a key or a unit: "⌘K", "Claude · Opus".
	const parts = words.split(/[\s·,/|:()+–-]+/).filter((part) => /[A-Za-z]/.test(part));
	return parts.some((part) => !NAMES.has(part) && !/^(⌘|⇧|⌥|⌃)?[A-Z]$/.test(part) && !/^[A-Z0-9]{1,4}$/.test(part));
}

function bare(path) {
	const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
	const found = [];
	const visit = (node) => {
		if (ts.isJsxText(node) && english(node.text)) found.push(node.text.replace(/\s+/g, " ").trim());
		else if (ts.isJsxAttribute(node) && READ.has(node.name.getText(source)) && node.initializer) {
			const value = node.initializer;
			const text = ts.isStringLiteral(value) ? value.text : value.expression && (ts.isStringLiteral(value.expression) || ts.isNoSubstitutionTemplateLiteral(value.expression)) ? value.expression.text : undefined;
			if (text !== undefined && english(text)) found.push(`${node.name.getText(source)}="${text}"`);
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return found;
}

const counts = {};
const words = {};
for (const dir of DIRS) for (const path of files(join(root, dir))) {
	const found = bare(path);
	if (found.length) {
		counts[relative(root, path)] = found.length;
		words[relative(root, path)] = found;
	}
}
const total = Object.values(counts).reduce((sum, n) => sum + n, 0);

if (process.argv.includes("--report")) {
	for (const [file, list] of Object.entries(words).sort((a, b) => b[1].length - a[1].length)) console.log(`${file} (${list.length})\n  ${list.slice(0, 12).join("\n  ")}${list.length > 12 ? "\n  …" : ""}`);
	console.log(`\n${total} bare English words in ${Object.keys(counts).length} files`);
	process.exit(0);
}
if (process.argv.includes("--update")) {
	writeFileSync(BASELINE, `${JSON.stringify({ total, files: Object.fromEntries(Object.entries(counts).sort()) }, null, "\t")}\n`);
	console.log(`i18n baseline: ${total} bare English words in ${Object.keys(counts).length} files`);
	process.exit(0);
}

const problems = [];
try {
	execFileSync("node", [join(root, "packages", "i18n", "compile.mjs"), "--check"], { stdio: ["ignore", "ignore", "pipe"] });
} catch (error) {
	problems.push(String(error.stderr ?? error.message).trim());
}
const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")).files : {};
for (const [file, n] of Object.entries(counts)) {
	const held = baseline[file] ?? 0;
	if (n > held) problems.push(`${file}: ${n} bare English word${n === 1 ? "" : "s"}, held at ${held}: write them as messages (@decks/i18n, m.…()). New: ${words[file].slice(0, 5).join(" | ")}`);
}
if (problems.length) {
	console.error(`i18n gate:\n${problems.join("\n")}`);
	process.exit(1);
}
const lower = Object.entries(baseline).some(([file, n]) => (counts[file] ?? 0) < n);
console.log(`i18n gate: messages complete; ${total} bare English words left${lower ? " (fewer than the baseline: run --update to hold the lower count)" : ""}`);
