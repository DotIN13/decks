#!/usr/bin/env node
// The switch-over: node tools/switch/run.mjs --dry prints the plan and writes docs/rewrite/switch-plan.md.
// Without --dry it carries the plan out as commits, the gates passing after each; it refuses to
// unless given --stop-3-passed, which Mason says when stop 3 passes. Nothing in any deck is touched.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { compatNames, lanesNeeded, plan, REPLACED, ROOT, rootFiles, specifier } from "./plan.mjs";

const REPLACED_GONE = REPLACED.map((r) => r.old);
import { render } from "./render.mjs";

const PLAN_FILE = "docs/rewrite/switch-plan.md";
const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** Commit only the switch's own paths: never git add -A, others' half-written files share this tree. */
function commit(paths, title, body) {
	git("add", "--", ...paths.filter((f) => existsSync(join(ROOT, f))));
	git("commit", "-q", "-m", `${title}\n\n${body}\n\nChecked: node tools/gates/run.mjs\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, "--", ...paths);
}

function gates() {
	spawnSync(process.execPath, ["tools/gates/run.mjs", "--shrink"], { cwd: ROOT, stdio: "ignore" });
	const r = spawnSync(process.execPath, ["tools/gates/run.mjs"], { cwd: ROOT, encoding: "utf8" });
	if (r.status !== 0) throw new Error(`the gates fail; stopping here:\n${r.stdout.split("\n").filter((l) => /FAIL|^\s{6}\S/.test(l)).slice(0, 20).join("\n")}`);
}

/** Where a target the old place named lives after the switch: moved files, the fixture, the page's icon. */
const RETARGET = [["e2e/fixture/decks/", "tools/fixtures/deck/"], ["apps/web/public/", "harness/page/public/"]];

/**
 * A moved file's relative paths, read from its old place and written from its new one: imports and
 * dynamic imports, and the paths it joins to its own address (new URL(…, import.meta.url),
 * join/resolve(dirname(fileURLToPath(import.meta.url)), …)). A path to another moved file names its new place.
 */
export function relocate(text, from, to, moves) {
	const fix = (rel) => {
		let target = posix.normalize(posix.join(posix.dirname(from), rel));
		if (target.startsWith("..")) return rel;
		target = moves.get(target) ?? target;
		for (const [old, now] of RETARGET) if (target.startsWith(old)) target = now + target.slice(old.length);
		const back = posix.relative(posix.dirname(to), target) || ".";
		return `${back.startsWith(".") ? back : `./${back}`}${rel.endsWith("/") && !back.endsWith("/") ? "/" : ""}`;
	};
	const quoted = (q, rel) => `${q}${fix(rel)}${q}`;
	return text
		// Only the file's own imports: a line that starts with import or export, or import(…) in code; never a path inside a string it writes.
		.replace(/^(\s*(?:import|export)\b[^\n'"`]*?(?:\bfrom\s*)?)(["'])(\.\.?\/[^"']*)\2/gm, (all, lead, q, rel) => `${lead}${quoted(q, rel)}`)
		.replace(/((?<![\w'"])import\s*\(\s*)(["'])(\.\.?\/[^"']*)\2/g, (all, lead, q, rel) => `${lead}${quoted(q, rel)}`)
		.replace(/(new URL\(\s*)(["'`])(\.\.?\/[^"'`]*)\2(\s*,\s*import\.meta\.url)/g, (all, lead, q, rel, tail) => `${lead}${quoted(q, rel)}${tail}`)
		.replace(/((?:join|resolve)\(\s*dirname\(\s*fileURLToPath\(\s*import\.meta\.url\s*\)\s*\)\s*,\s*)(["'`])(\.\.?\/[^"'`]*)\2/g, (all, lead, q, rel) => `${lead}${quoted(q, rel)}`);
}

/** The helpers every check shares, beside the runner after the switch. */
const HELPERS = ["harness.mjs", "backends-kit.mjs", "awake-canvas.mjs", "perf-canvas.mjs", "fake-model.mjs"];

function moveChecks(p) {
	const moves = new Map([...p.checks.moved.map((m) => [`e2e/checks/${m.check}.mjs`, m.to]), ...HELPERS.filter((h) => existsSync(join(ROOT, "e2e", h))).map((h) => [`e2e/${h}`, `tools/checks/${h}`])]);
	for (const [from, to] of moves) {
		mkdirSync(dirname(join(ROOT, to)), { recursive: true });
		git("mv", from, to);
	}
	git("mv", "e2e/fake-agent", "tools/checks/fake-agent");
	for (const [from, to] of moves) {
		const file = join(ROOT, to);
		const text = readFileSync(file, "utf8");
		const next = relocate(text, from, to, moves);
		if (next !== text) writeFileSync(file, next);
	}
	// The old stale-paths script lists files that tell history on purpose, by path: they move too.
	const stale = join(ROOT, "scripts/stale-paths.mjs");
	if (existsSync(stale)) writeFileSync(stale, [...moves].reduce((t, [from, to]) => t.split(`"${from}"`).join(`"${to}"`), readFileSync(stale, "utf8")));
	// Each check's place is a field beside its others in checks.json; its baseline keys move with it.
	const file = join(ROOT, "tools/checks/checks.json");
	const json = JSON.parse(readFileSync(file, "utf8"));
	for (const m of p.checks.moved) json.checks[m.check] = { ...(json.checks[m.check] ?? {}), path: m.to };
	writeFileSync(file, `${JSON.stringify(json, null, "\t")}\n`);
	execFileSync(process.execPath, ["tools/gates/rekey.mjs", ...[...moves].flat(), "e2e/fake-agent", "tools/checks/fake-agent"], { cwd: ROOT, stdio: "inherit" });
	gates();
	const paths = [...[...moves].flat(), "e2e/fake-agent", "tools/checks/fake-agent", "tools/checks/checks.json", "tools/gates/baseline", "scripts/stale-paths.mjs"];
	commit(paths, "Move every browser check to the feature that owns it", "Stop 3's checks go to their owners' features, the agent checks to tools/checks/agent, the benches to tools/checks/bench, the rest by what they exercise; the shared helpers, the fake model and agent go beside the runner. Each moved file's relative paths are read from its old place and written from its new one, the fixture now tools/fixtures/deck and the page's icon harness/page/public; nothing else in a check changes. tools/checks/checks.json gives each its path, and the gate baselines' keys move with the files.");
}

function deleteOld(p) {
	const gone = p.deletions.filter((d) => d.delete).map((d) => d.old);
	// A folder goes whole but for the files it keeps for Loom (runtime/live-doc.ts).
	for (const d of p.deletions.filter((x) => x.delete)) {
		const keep = Object.keys(d.keep ?? {});
		const files = git("ls-files", d.old).split("\n").filter((f) => f && !keep.includes(f));
		for (let i = 0; i < files.length; i += 200) git("rm", "-q", "--", ...files.slice(i, i + 200));
	}
	gates();
	commit(gone, "Delete the code the new folders replaced", `Gone, each with its new home and proof in ${PLAN_FILE}: ${gone.join(", ")}.`);
	return gone;
}

/** The kept old package that a new name takes is renamed first (to <name>-old), with every specifier of it. */
function renameOld(p) {
	const touched = [];
	for (const c of p.clashes) {
		for (const f of c.files) {
			const text = readFileSync(join(ROOT, f), "utf8");
			const next = text.replace(specifier(c.name), `$1${c.to}`);
			if (next !== text) (writeFileSync(join(ROOT, f), next), touched.push(f));
		}
	}
	return touched;
}

function rename(p) {
	const old = renameOld(p);
	const files = git("ls-files").split("\n").filter((f) => /\.(ts|tsx|mjs|mts|js|json|md)$/.test(f) && !f.endsWith("package-lock.json") && existsSync(join(ROOT, f)));
	const touched = [];
	for (const f of files) {
		const text = readFileSync(join(ROOT, f), "utf8");
		const next = p.renames.reduce((t, r) => t.split(r.from).join(r.to), text);
		if (next !== text) (writeFileSync(join(ROOT, f), next), touched.push(f));
	}
	execFileSync(process.execPath, ["tools/heavy.mjs", "--wait", "--", "npm", "install", "--include=dev", "--no-audit", "--no-fund"], { cwd: ROOT, stdio: "inherit" });
	gates();
	const clash = p.clashes.map((c) => `${c.dir} is called ${c.to} until Loom moves it, its ${c.files.length} importers' specifiers renamed and nothing else`).join("; ");
	commit([...new Set([...old, ...touched, "package-lock.json"])], "Rename the new packages from @decks-next to @decks", `${p.renames.map((r) => r.to).join(", ")}; ${touched.length} files.${clash ? ` First, so no two workspaces share a name: ${clash}.` : ""}`);
}

/** CI as the new programs run it: the cascade step goes (the built gate orders the page's sheets), the comments say what runs. */
export function ciFile(text) {
	const swap = (from, to) => {
		if (!text.includes(from)) throw new Error(`the CI file no longer says: ${from.slice(0, 60)}`);
		text = text.replace(from, to);
	};
	swap(text.slice(text.indexOf("      # **The cascade gate, on its own line"), text.indexOf("      # **Three more gates")), "");
	swap("      # **Three more gates, each its own line for the same reason.** An exported symbol nothing\n      # references, a class no markup writes, and a comment naming a file that no longer exists are\n      # the three kinds of residue a reorganization leaves behind and a reader pays for; typecheck\n      # and the tests are blind to all three. `scripts/dead-exports.mjs`, `dead-css.mjs` and\n      # `stale-paths.mjs` each exit 1 naming what they found.", "      # **The gates, on their own line.** The thirteen rules of tools/gates (sizes, names, imports,\n      # comments, the page's style order, residue such as a dead export or a stale file name and the\n      # rest), each against its baseline; typecheck and the tests are blind to all of them.");
	const from = text.indexOf("      # One command over every workspace:");
	swap(text.slice(from, text.indexOf("the browser checks.", from) + "the browser checks.".length), "      # One command over every workspace: the protocol, Decks-local, the harness and its page,\n      # the clients, the tools, and the libraries still in packages/.");
	return text;
}

function root(gone) {
	const r = rootFiles(gone);
	const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
	writeFileSync(join(ROOT, "package.json"), `${JSON.stringify({ ...pkg, workspaces: r.workspaces, scripts: r.scripts }, null, 2)}\n`);
	const ci = join(ROOT, ".github/workflows/test.yml");
	writeFileSync(ci, ciFile(readFileSync(ci, "utf8")));
	gates();
	commit(["package.json", ".github/workflows/test.yml"], "Point the root scripts, workspaces and CI at the new programs", r.ci);
}

async function main(argv) {
	const p = plan();
	const names = compatNames();
	const r = rootFiles(p.deletions.filter((d) => d.delete).map((d) => d.old));
	const text = render(p, names, r, lanesNeeded(p));
	if (argv.includes("--dry")) {
		writeFileSync(join(ROOT, PLAN_FILE), text);
		console.log(text);
		console.log(`\n(written to ${PLAN_FILE}; nothing else changed)`);
		return 0;
	}
	if (!argv.includes("--stop-3-passed")) return console.error("Refused: run --dry, or wait for Mason's 'stop 3 passed' and pass --stop-3-passed."), 2;
	// --step move|delete|rename|root runs one step (each re-plans from the tree as it is now); none runs all four.
	const step = argv.includes("--step") ? argv[argv.indexOf("--step") + 1] : undefined;
	const gone = () => REPLACED_GONE.filter((d) => !existsSync(join(ROOT, d)));
	const steps = { move: () => moveChecks(p), delete: () => deleteOld(p), rename: () => rename(p), root: () => root(gone()) };
	if (step && !steps[step]) return console.error(`--step is one of ${Object.keys(steps).join(", ")}`), 2;
	if (!step) writeFileSync(join(ROOT, PLAN_FILE), text);
	for (const [name, run] of Object.entries(steps)) if (!step || step === name) (run(), console.log(`switch-over: ${name} committed`));
	if (!step) console.log("switch-over done: run node tools/check.mjs for every folder, the whole type check, and the 76 checks.");
	return 0;
}

if (process.argv[1] === new URL(import.meta.url).pathname) process.exitCode = await main(process.argv.slice(2));
