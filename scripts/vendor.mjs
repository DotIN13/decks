/**
 * Put the board primitives into `runtime/lib`, from the packages in node_modules.
 *
 * Boards are standalone documents: `lib/` is copied into every deck so a board
 * renders a paper, a diagram and a formula with no network and no server. That
 * only works if the files are real files, so this script is how they get there —
 * committed output, reproducible from a command, rather than blobs someone once
 * downloaded and cannot re-derive.
 *
 * Mermaid is the one that has to be bundled rather than copied: its published ESM
 * entry is 32KB that dynamically imports a tree of chunks, and its self-contained
 * build hangs itself off a global named after an internal build step. So esbuild
 * flattens it into one module with one default export.
 *
 *     npm run vendor
 */
import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const modules = join(root, "node_modules");
const out = join(root, "runtime", "lib");

/** [from, to] — `to` is relative to runtime/lib. */
const FILES = [
	["d3/dist/d3.min.js", "d3.min.js"],
	["marked/lib/marked.umd.js", "marked.umd.js"],
	["katex/dist/katex.min.js", "katex.min.js"],
	["katex/dist/katex.min.css", "katex.min.css"],
	// Renamed on purpose: `auto-render.min.js` says nothing about which library it
	// belongs to once it is sitting in a directory beside four others.
	["katex/dist/contrib/auto-render.min.js", "katex-auto-render.min.js"],
	["pdfjs-dist/build/pdf.min.mjs", "pdf.min.mjs"],
	["pdfjs-dist/build/pdf.worker.min.mjs", "pdf.worker.min.mjs"],
];

/** Directories copied whole. */
const DIRS = [
	["katex/dist/fonts", "fonts"],
	// A PDF that does not embed its fonts needs these, which is most papers.
	["pdfjs-dist/standard_fonts", "standard_fonts"],
	// pdf.js 6 does its image and colour decoding in wasm.
	["pdfjs-dist/wasm", "wasm"],
];

function missing(path) {
	console.error(`[vendor] not found: ${path}`);
	console.error("[vendor] run npm install first.");
	process.exit(1);
}

mkdirSync(out, { recursive: true });

let bytes = 0;
for (const [from, to] of FILES) {
	const source = join(modules, from);
	if (!existsSync(source)) missing(source);
	cpSync(source, join(out, to));
	bytes += statSync(source).size;
	console.log(`[vendor] ${to}`);
}

for (const [from, to] of DIRS) {
	const source = join(modules, from);
	if (!existsSync(source)) missing(source);
	const target = join(out, to);
	rmSync(target, { recursive: true, force: true });
	cpSync(source, target, { recursive: true });
	console.log(`[vendor] ${to}/`);
}

const mermaidOut = join(out, "mermaid.bundle.mjs");
await build({
	stdin: {
		contents: 'export { default } from "mermaid";',
		resolveDir: root,
		loader: "js",
	},
	bundle: true,
	format: "esm",
	minify: true,
	platform: "browser",
	target: ["es2022"],
	outfile: mermaidOut,
	logLevel: "error",
	// Mermaid pulls in optional diagram packs it can live without; letting esbuild
	// fail on one of those would fail the whole vendoring for a diagram type
	// nobody asked for.
	logOverride: { "ignored-bare-import": "silent" },
});
console.log(`[vendor] mermaid.bundle.mjs`);

// A note beside the files saying where they came from, since `lib/` is copied
// into decks and someone will eventually find it there without this repo.
const versions = Object.fromEntries(
	["d3", "marked", "katex", "mermaid", "pdfjs-dist"].map((name) => [
		name,
		JSON.parse(readFileSync(join(modules, name, "package.json"), "utf8")).version,
	]),
);
writeFileSync(
	join(out, "VENDORED.md"),
	[
		"# Vendored board primitives",
		"",
		"Copied here by `npm run vendor` in the decks repo. `board.css` and `board.js`",
		"are Decks' own; everything else is upstream, unmodified except for the two",
		"renames noted in `scripts/vendor.mjs`.",
		"",
		...Object.entries(versions).map(([name, version]) => `- ${name} ${version}`),
		"",
	].join("\n"),
);

console.log(`[vendor] done — ${(bytes / 1024 / 1024).toFixed(1)} MB of files plus the bundle and directories`);
