/**
 * The shape gate: how tangled and how long the code is, counted, and held so it can only get better.
 *
 *     node scripts/shape.mjs             # exit 1 when a count grew, or a new import points up
 *     node scripts/shape.mjs --report    # print every count and where it comes from
 *     node scripts/shape.mjs --update    # write the baseline from the code as it is (after an improvement)
 *
 * Two things are held against `scripts/shape-baseline.json`.
 *
 * **Counts** that may only fall: files over 1,000 lines, functions over 150 lines, classes with more
 * than 30 methods, pairs of server folders that import each other, imports that reach across
 * packages by relative path, and notes that promise to remove something "in one release". Counted in
 * shipping TypeScript (tests, the browser checks, scripts, generated and vendored code left out).
 *
 * **The server's layers**, bottom to top: the deck and auth; the canvas; the features; the agents and
 * their runtimes; the calls; the connections; the upgrade scripts; start-up (`LAYERS`). A file imports from its own layer
 * or below. Every import that points up today is listed in the baseline, and the list may only
 * shrink: a new one fails, naming the two files. The old folder names and the new ones are both in
 * the table, so the gate holds while folders move.
 *
 * After a change that lowers a count or removes an upward import, run `--update`: the gate then holds
 * the better number.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = join(root, "scripts", "shape-baseline.json");
const SERVER = "apps/server/src/";
const LIMITS = { fileLines: 1000, functionLines: 150, classMethods: 30 };

/** The server's layers, lowest first: a path under `apps/server/src/` belongs to the first entry it starts with. */
const LAYERS = [
	["start-up", ["index.ts", "app.ts", "main.ts"]],
	// Upgrade scripts run at start-up and may use any layer; the running code must not reach into them.
	["upgrades", ["migrations/"]],
	["connections", ["connections/", "http.ts", "line.ts", "ws.ts", "routes/", "wire/"]],
	["calls", ["calls/"]],
	["agents", ["agents/", "runtimes/"]],
	["features", ["cards/", "docs/", "apps/", "pictures/", "files/", "share/", "studio/", "google/", "browser/"]],
	["canvas", ["canvas/", "stage/"]],
	["base", ["deck/", "auth/", "lib/", ""]],
];
const layerOf = (path) => {
	const rest = path.slice(SERVER.length);
	const index = LAYERS.findIndex(([, starts]) => starts.some((start) => rest.startsWith(start)));
	// Listed top first: a higher layer has a higher number.
	return LAYERS.length - 1 - index;
};
const layerName = (level) => LAYERS[LAYERS.length - 1 - level][0];

const tracked = execSync("git ls-files", { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
const shipping = tracked.filter((file) => /\.(ts|tsx)$/.test(file) && /^(apps|packages|runtime|extension)\//.test(file) && !/\.d\.ts$|\.test\.|\.check\.|\/test\/|\/fixtures?\/|(^|\/)(dist|pkg|pkg-gl|lib|vendor)\//.test(file));
const sources = new Map(shipping.map((file) => [file, readFileSync(join(root, file), "utf8")]));

// ---- the counts --------------------------------------------------------------------------------

const longFiles = [];
const longFunctions = [];
const bigClasses = [];
const notes = [];
/** Every relative import of every file: `[from, to]`, both from the repository's root. */
const imports = [];

const lineOf = (source, position) => source.getLineAndCharacterOfPosition(position).line;
const nameOf = (node) => (node.name && ts.isIdentifier(node.name) ? node.name.text : ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name) ? node.parent.name.text : ts.isPropertyAssignment(node.parent) && ts.isIdentifier(node.parent.name) ? node.parent.name.text : "(a function)");
const resolveImport = (from, spec) => {
	const base = resolve(root, dirname(from), spec);
	for (const candidate of [base, `${base}.ts`, `${base}.tsx`, base.replace(/\.js$/, ".ts"), join(base, "index.ts")]) {
		if (existsSync(candidate) && statSync(candidate).isFile()) return relative(root, candidate);
	}
	return relative(root, base);
};

for (const [file, text] of sources) {
	const lines = text.split("\n").length;
	if (lines > LIMITS.fileLines) longFiles.push(`${file}: ${lines}`);
	for (const found of text.matchAll(/one release/gi)) notes.push(`${file}:${text.slice(0, found.index).split("\n").length}`);
	const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
	const visit = (node) => {
		if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
			const spec = node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : undefined;
			// A type-only import ties two files together as much as any other: a reader still follows it.
			if (spec?.startsWith(".")) imports.push([file, resolveImport(file, spec)]);
		}
		if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) && node.body) {
			const length = lineOf(source, node.end) - lineOf(source, node.getStart(source)) + 1;
			if (length > LIMITS.functionLines) longFunctions.push(`${file}: ${nameOf(node)}: ${length}`);
		}
		if (ts.isClassDeclaration(node)) {
			const methods = node.members.filter((member) => ts.isMethodDeclaration(member) || ts.isGetAccessor(member) || ts.isSetAccessor(member)).length;
			if (methods > LIMITS.classMethods) bigClasses.push(`${file}: ${node.name?.text ?? "(a class)"}: ${methods}`);
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
}

/** A server file's folder, as a reader sees it: its first folder, or the top level. */
const folderOf = (path) => {
	const rest = path.slice(SERVER.length);
	return rest.includes("/") ? rest.slice(0, rest.indexOf("/")) : "(top)";
};
const server = imports.filter(([from, to]) => from.startsWith(SERVER) && to.startsWith(SERVER));
const edges = new Set(server.map(([from, to]) => `${folderOf(from)}>${folderOf(to)}`).filter((edge) => edge.split(">")[0] !== edge.split(">")[1]));
const pairs = [...edges].filter((edge) => {
	const [a, b] = edge.split(">");
	return a < b && edges.has(`${b}>${a}`);
}).map((edge) => edge.replace(">", " <> ")).sort();

const packageOf = (path) => path.split("/").slice(0, 2).join("/");
const across = imports.filter(([from, to]) => packageOf(from) !== packageOf(to) && /^(apps|packages|runtime|extension)\//.test(to)).map(([from, to]) => `${from} -> ${to}`).sort();
const upward = [...new Set(server.filter(([from, to]) => layerOf(to) > layerOf(from)).map(([from, to]) => `${from} -> ${to}`))].sort();

const counts = {
	"files over 1,000 lines": longFiles.length,
	"functions over 150 lines": longFunctions.length,
	"classes over 30 methods": bigClasses.length,
	"server folder pairs that import each other": pairs.length,
	"imports across packages by relative path": across.length,
	'"one release" notes': notes.length,
	"server imports that point up a layer": upward.length,
};

// ---- report, update, or hold -------------------------------------------------------------------

if (process.argv.includes("--report")) {
	const show = (title, list) => console.log(`\n${title} (${list.length})\n${list.map((one) => `  ${one}`).join("\n")}`);
	console.log(JSON.stringify(counts, null, "\t"));
	show("Files over 1,000 lines", longFiles.sort((a, b) => Number(b.split(": ")[1]) - Number(a.split(": ")[1])));
	show("Functions over 150 lines", longFunctions.sort((a, b) => Number(b.split(": ").at(-1)) - Number(a.split(": ").at(-1))));
	show("Classes over 30 methods", bigClasses);
	show("Server folder pairs that import each other", pairs);
	show("Imports across packages by relative path", across);
	const byLayers = new Map();
	for (const one of upward) {
		const [from, to] = one.split(" -> ");
		const key = `${layerName(layerOf(from))} -> ${layerName(layerOf(to))}`;
		byLayers.set(key, (byLayers.get(key) ?? 0) + 1);
	}
	show("Server imports that point up, by layer", [...byLayers].map(([key, count]) => `${key}: ${count}`));
	process.exit(0);
}

if (process.argv.includes("--json")) {
	console.log(JSON.stringify(counts));
	process.exit(0);
}

if (process.argv.includes("--update")) {
	writeFileSync(BASELINE, `${JSON.stringify({ counts, upward }, null, "\t")}\n`);
	console.log(`shape: the baseline is the code as it is (${Object.entries(counts).map(([name, count]) => `${count} ${name}`).join("; ")})`);
	process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
const problems = [];
for (const [name, count] of Object.entries(counts)) {
	const held = baseline.counts[name];
	if (held !== undefined && count > held) problems.push(`${name}: ${count}, where the baseline holds ${held}. node scripts/shape.mjs --report lists them.`);
}
const known = new Set(baseline.upward);
for (const one of upward) if (!known.has(one)) problems.push(`a new import points up a layer (${layerName(layerOf(one.split(" -> ")[0]))} to ${layerName(layerOf(one.split(" -> ")[1]))}): ${one}`);
if (problems.length) {
	console.error(`shape: ${problems.length} thing${problems.length === 1 ? "" : "s"} got worse:\n${problems.map((one) => `  ${one}`).join("\n")}`);
	process.exit(1);
}
const better = Object.entries(counts).filter(([name, count]) => count < (baseline.counts[name] ?? count));
console.log(`shape holds${better.length ? `, and ${better.map(([name, count]) => `${name} fell to ${count}`).join(", ")}: run node scripts/shape.mjs --update` : ""} (${upward.length} imports point up, ${pairs.length} folder pairs import each other)`);
