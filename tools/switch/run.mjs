#!/usr/bin/env node
// The switch-over: node tools/switch/run.mjs --dry prints the plan and writes docs/rewrite/switch-plan.md.
// Without --dry it carries the plan out as commits, the gates passing after each; it refuses to
// unless given --stop-3-passed, which Mason says when stop 3 passes. Nothing in any deck is touched.
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { compatNames, lanesNeeded, plan, ROOT, rootFiles, specifier } from "./plan.mjs";
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

/** A moved check's ../ imports point at tools/checks, where the helpers they name now live. */
function rewriteImports(file, helpers) {
	const text = readFileSync(join(ROOT, file), "utf8");
	const next = text.replace(/(["'])\.\.\/([\w.-]+\.mjs)\1/g, (all, q, name) => {
		helpers.add(name);
		const to = relative(dirname(join(ROOT, file)), join(ROOT, "tools/checks", name));
		return `${q}${to.startsWith(".") ? to : `./${to}`}${q}`;
	});
	writeFileSync(join(ROOT, file), next);
}

function moveChecks(p) {
	const helpers = new Set(["harness.mjs"]);
	for (const m of p.checks.moved) {
		mkdirSync(dirname(join(ROOT, m.to)), { recursive: true });
		git("mv", `e2e/checks/${m.check}.mjs`, m.to);
		rewriteImports(m.to, helpers);
	}
	for (const name of helpers) if (existsSync(join(ROOT, "e2e", name))) copyFileSync(join(ROOT, "e2e", name), join(ROOT, "tools/checks", name));
	// The fake model and agent the agent checks drive Pi with move beside the runner, which looks there first.
	for (const name of ["fake-model.mjs", "fake-agent"]) git("mv", `e2e/${name}`, `tools/checks/${name}`);
	const harness = join(ROOT, "tools/checks/harness.mjs");
	writeFileSync(harness, readFileSync(harness, "utf8").replace("./fixture/decks/", "../fixtures/deck/"));
	// Each check's place is a field beside its others in checks.json.
	const file = join(ROOT, "tools/checks/checks.json");
	const json = JSON.parse(readFileSync(file, "utf8"));
	for (const m of p.checks.moved) json.checks[m.check] = { ...(json.checks[m.check] ?? {}), path: m.to };
	writeFileSync(file, `${JSON.stringify(json, null, "\t")}\n`);
	gates();
	const paths = [...p.checks.moved.flatMap((m) => [m.to, `e2e/checks/${m.check}.mjs`]), ...[...helpers].map((h) => `tools/checks/${h}`), "e2e/fake-model.mjs", "e2e/fake-agent", "tools/checks/fake-model.mjs", "tools/checks/fake-agent", "tools/checks/checks.json"];
	commit(paths, "Move every browser check to the feature that owns it", "Stop 3's checks go to their owners' features, the agent checks to tools/checks/agent, the benches to tools/checks/bench, the rest by what they exercise; each ../ import points at tools/checks, and nothing else in a check changes. tools/checks/checks.json gives each its path; the fake model and agent move beside the runner.");
}

function deleteOld(p) {
	const gone = p.deletions.filter((d) => d.delete).map((d) => d.old);
	for (const dir of gone) git("rm", "-r", "-q", dir);
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

function root(gone) {
	const r = rootFiles(gone);
	const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
	writeFileSync(join(ROOT, "package.json"), `${JSON.stringify({ ...pkg, workspaces: r.workspaces, scripts: r.scripts }, null, 2)}\n`);
	gates();
	commit(["package.json"], "Point the root scripts and workspaces at the new programs", r.ci);
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
	writeFileSync(join(ROOT, PLAN_FILE), text);
	moveChecks(p);
	const gone = deleteOld(p);
	rename(p);
	root(gone);
	console.log("switch-over done: run node tools/check.mjs for every folder, the whole type check, and the 76 checks.");
	return 0;
}

if (process.argv[1] === new URL(import.meta.url).pathname) process.exitCode = await main(process.argv.slice(2));
