#!/usr/bin/env node
// The switch-over: node tools/switch/run.mjs --dry prints the plan and writes docs/rewrite/switch-plan.md.
// Without --dry it carries the plan out as commits, the gates passing after each; it refuses to
// unless given --stop-3-passed, which Mason says when stop 3 passes. Nothing in any deck is touched.
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { compatNames, plan, ROOT, rootFiles } from "./plan.mjs";
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
	const where = {};
	for (const m of p.checks.moved) {
		mkdirSync(dirname(join(ROOT, m.to)), { recursive: true });
		git("mv", `e2e/checks/${m.check}.mjs`, m.to);
		rewriteImports(m.to, helpers);
		where[m.check] = m.to;
	}
	for (const name of helpers) if (existsSync(join(ROOT, "e2e", name))) copyFileSync(join(ROOT, "e2e", name), join(ROOT, "tools/checks", name));
	const harness = join(ROOT, "tools/checks/harness.mjs");
	writeFileSync(harness, readFileSync(harness, "utf8").replace("./fixture/decks/", "../fixtures/deck/"));
	writeFileSync(join(ROOT, "tools/checks/where.json"), `${JSON.stringify(where, null, "\t")}\n`);
	gates();
	const paths = [...p.checks.moved.flatMap((m) => [m.to, `e2e/checks/${m.check}.mjs`]), ...[...helpers].map((h) => `tools/checks/${h}`), "tools/checks/where.json"];
	commit(paths, "Move today's browser checks to the features that own them", "Each of stop 3's checks moves to its owner's feature, its ../harness.mjs import pointed at tools/checks; nothing else in a check changes. tools/checks/where.json says where each is.");
}

function deleteOld(p) {
	const gone = p.deletions.filter((d) => d.delete).map((d) => d.old);
	for (const dir of gone) git("rm", "-r", "-q", dir);
	gates();
	commit(gone, "Delete the code the new folders replaced", `Gone, each with its new home and proof in ${PLAN_FILE}: ${gone.join(", ")}.`);
	return gone;
}

function rename(p) {
	const files = git("ls-files").split("\n").filter((f) => /\.(ts|tsx|mjs|mts|js|json|md)$/.test(f) && !f.endsWith("package-lock.json") && existsSync(join(ROOT, f)));
	const touched = [];
	for (const f of files) {
		const text = readFileSync(join(ROOT, f), "utf8");
		const next = p.renames.reduce((t, r) => t.split(r.from).join(r.to), text);
		if (next !== text) (writeFileSync(join(ROOT, f), next), touched.push(f));
	}
	execFileSync(process.execPath, ["tools/heavy.mjs", "--wait", "--", "npm", "install", "--include=dev", "--no-audit", "--no-fund"], { cwd: ROOT, stdio: "inherit" });
	gates();
	commit([...touched, "package-lock.json"], "Rename the new packages from @decks-next to @decks", `${p.renames.map((r) => r.to).join(", ")}; ${touched.length} files.`);
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
	const text = render(p, names, r);
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
