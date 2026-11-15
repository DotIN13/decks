// Each gate, planted with one break in a scratch folder, fails and names it; the clean twin passes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ROOT, compare, context } from "./lib.mjs";
import { runGates } from "./run.mjs";

function scratch(files, git = false) {
	const dir = mkdtempSync(join(tmpdir(), "gates-"));
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, path)), { recursive: true });
		writeFileSync(join(dir, path), text);
	}
	if (git) {
		const g = (...a) => execFileSync("git", a, { cwd: dir, stdio: "ignore" });
		g("init", "-q");
		g("-c", "user.email=t@t", "-c", "user.name=t", "add", ".");
	}
	return dir;
}

async function breaks(gateName, files, git) {
	const gate = (await import(`./${gateName}.mjs`)).default;
	const { counts } = gate.scan(context(scratch(files, git)));
	return compare(counts, {}).over.map((o) => o.key);
}

async function plantedFails(gateName, bad, good, needle, git) {
	const named = await breaks(gateName, bad, git);
	assert.ok(named.some((k) => k.includes(needle)), `${gateName} should name ${needle}, named ${JSON.stringify(named)}`);
	assert.deepEqual((await breaks(gateName, good, git)).filter((k) => k.includes(needle)), []);
}

const lines = (n, line = "x;") => `${Array.from({ length: n }, () => line).join("\n")}\n`;
const fn = (n) => `export function long() {\n${lines(n - 2, "\tcall();")}}\n`;
const TICK = String.fromCharCode(96);
const README = "# x\n## Owns\na\n## May import\nb\n## Rules\nc\n## Check\nd\n";

test("size names a file over 1,000 lines", () => plantedFails("size", { "server/a/big.ts": lines(1001) }, { "server/a/big.ts": lines(1000) }, "server/a/big.ts: over 1000 lines"));
test("size names a function over 80 lines", () => plantedFails("size", { "server/a/f.ts": fn(81) }, { "server/a/f.ts": fn(80) }, "function long"));
test("names names a retired word, even inside an identifier", () =>
	plantedFails("names", { "server/a/x.ts": "const boardCamera = 1;\n" }, { "server/a/x.ts": "const cardCamera = 1;\n" }, "server/a/x.ts: board"));
test("names reads its words from protocol/glossary.ts", () =>
	plantedFails("names", { "protocol/glossary.ts": 'export const retired = [{ word: "widget", now: "card" }];\n', "server/x.ts": "// widgets\n" },
		{ "protocol/glossary.ts": 'export const retired = [{ word: "widget", now: "card" }];\n', "server/x.ts": "// cards\n" }, "server/x.ts: widget"));
test("names passes the markup names by rule, only as markup", () =>
	plantedFails("names", { "server/a/x.ts": 'el.querySelector(".stage-ink"); const stageSize = 1;\n' }, { "server/a/x.ts": 'el.querySelector(".stage-ink"); el.classList.add("stage-fixed"); const s = `<i class="stage x">`;\n' }, "server/a/x.ts: stage"));
test("names reads a check's name and path in checks.json as its file's", async () =>
	assert.deepEqual(await breaks("names", { "tools/checks/library/stage-scroll.mjs": "// a check\n", "tools/checks/checks.json": '{ "checks": { "stage-scroll": { "path": "tools/checks/library/stage-scroll.mjs" } } }\n' }), []));
test("names lets compat/ keep retired words", async () => assert.deepEqual(await breaks("names", { "server/compat/old.ts": "// board\n" }), []));
test("imports names a folder importing against the table", () =>
	plantedFails("imports", { "protocol/a.ts": 'import x from "node:fs";\n' }, { "protocol/a.ts": 'import x from "./b.ts";\n' }, "protocol may not import node:fs"));
test("imports names server importing the harness", () =>
	plantedFails("imports", { "server/a.ts": 'import x from "../harness/main.ts";\n', "harness/main.ts": "" },
		{ "server/a.ts": 'import x from "../protocol/index.ts";\n', "protocol/index.ts": "" }, "server may not import harness"));
test("imports names a reach past a folder's entry", () =>
	plantedFails("imports", { "clients/sdk/a.ts": 'import x from "../../protocol/shapes.ts";\n', "protocol/shapes.ts": "" },
		{ "clients/sdk/a.ts": 'import x from "../../protocol/index.ts";\n', "protocol/index.ts": "" }, "reaches past the entry of protocol"));
test("imports names a server feature importing another", () =>
	plantedFails("imports", { "server/cards/a.ts": 'import x from "../canvas/doc.ts";\n' }, { "server/cards/a.ts": 'import x from "../kernel/deck.ts";\n' }, "feature cards may not import feature canvas"));
test("calls names a call declared twice", () =>
	plantedFails("calls", { "protocol/calls/a.ts": 'defineCall({ name: "item.move" })\n', "protocol/calls/b.ts": 'defineCall({ name: "item.move" })\n' },
		{ "protocol/calls/a.ts": 'defineCall({ name: "item.move" })\n' }, "item.move again"));
test("calls names a call declared outside protocol/", () =>
	plantedFails("calls", { "server/a.ts": 'defineCall({ name: "item.copy" })\n' }, { "protocol/a.ts": 'defineCall({ name: "item.copy" })\n' }, "outside protocol/"));
test("calls names a call handled twice", () =>
	plantedFails("calls", { "server/a/calls.ts": "handle(move, f);\n", "server/b/calls.ts": "handle(calls.move, g);\n" },
		{ "server/a/calls.ts": "handle(move, f);\n" }, "handles move again"));
test("readme names a folder with none", () => plantedFails("readme", { "server/canvas/doc.ts": "", "server/README.md": README },
	{ "server/canvas/doc.ts": "", "server/canvas/README.md": README, "server/README.md": README }, "server/canvas: has no README.md"));
test("readme names one over 60 lines", () => plantedFails("readme", { "tools/README.md": README + lines(60, "a") }, { "tools/README.md": README }, "README over 60 lines"));
test("comments names a comment over 5 lines", () =>
	plantedFails("comments", { "server/a.ts": `${lines(6, "// a")}x();\n` }, { "server/a.ts": `${lines(5, "// a")}x();\n` }, "comment over 5 lines"));
test("comments names an em dash", () => plantedFails("comments", { "server/README.md": "a — b\n" }, { "server/README.md": "a, b\n" }, "em dash"));
test("commits names a message without Checked:", async () => {
	const { messageProblems } = await import("./commits.mjs");
	assert.deepEqual(messageProblems("Fix it\n\nBecause.\n\nChecked: npm test\n"), []);
	assert.match(messageProblems(`${"x".repeat(73)}\n\nwhy\n`).join(), /73 characters.*Checked/);
});
test("commits names a bad commit in a repository", async () => {
	const dir = scratch({ "a.txt": "a" }, true);
	execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "no body"], { cwd: dir });
	const gate = (await import("./commits.mjs")).default;
	assert.match([...gate.scan(context(dir)).counts.keys()].join(), /has no body/);
});
test("parts names a part missing its model", () =>
	plantedFails("parts", { "harness/page/chat/view.tsx": "", "harness/page/chat/actions.ts": "" },
		{ "harness/page/chat/view.tsx": "", "harness/page/chat/actions.ts": "", "harness/page/chat/model.ts": "" }, "no model.ts"));
test("state names a top-level let", () => plantedFails("state", { "server/a.ts": "let count = 0;\n" }, { "server/a.ts": "const count = 0;\n" }, "top-level let count"));
test("built names an engine binary", () => plantedFails("built", { "engine/out.wasm": "" }, { "engine/out.rs": "" }, "engine/out.wasm"));
test("lanes names a lane given twice", () =>
	plantedFails("lanes", { "docs/rewrite/lanes.json": '{"A":["x/"],"B":["x/"]}' }, { "docs/rewrite/lanes.json": '{"A":["x/"],"B":["x/y.ts"]}' }, "x/ is in the lanes of A and B"));
test("lanes refuses a staged path outside the author's lane", () => {
	const dir = scratch({ "docs/rewrite/lanes.json": '{"Ann":["mine/"]}', "mine/a.ts": "", "theirs/b.ts": "" }, true);
	const run = (agent) => spawnSync(process.execPath, [join(ROOT, "tools/gates/lanes.mjs"), "--staged"], { cwd: dir, encoding: "utf8", env: { ...process.env, REWRITE_AGENT: agent } });
	const r = run("Ann");
	assert.equal(r.status, 1);
	assert.match(r.stderr, /theirs\/b\.ts: outside Ann's lane/);
	assert.doesNotMatch(r.stderr, /mine\/a\.ts/);
	assert.match(run("").stderr, /has no lane/);
});
test("agents-md names a path that does not exist", () =>
	plantedFails("agents-md", { "AGENTS.md": `See ${TICK}server/ghost.ts${TICK}.\n`, "server/real.ts": "" }, { "AGENTS.md": `See ${TICK}server/real.ts${TICK}.\n`, "server/real.ts": "" }, "server/ghost.ts"));
test("agents-md names a map over 150 lines", () => plantedFails("agents-md", { "AGENTS.md": lines(151, "a") }, { "AGENTS.md": lines(150, "a") }, "over 150 lines"));
test("legacy names what scripts/stale-paths.mjs finds", async () => {
	const files = { "docs/a.md": `See ${TICK}ghost.ts${TICK}.\n` };
	const dir = scratch(files, true);
	mkdirSync(join(dir, "scripts"));
	copyFileSync(join(ROOT, "scripts/stale-paths.mjs"), join(dir, "scripts/stale-paths.mjs"));
	execFileSync("git", ["add", "."], { cwd: dir });
	const gate = (await import("./legacy.mjs")).default;
	assert.match([...gate.scan(context(dir)).counts.keys()].join(), /stale-paths: docs\/a\.md: ghost\.ts/);
});
test("run fails a baseline that grew since HEAD", async () => {
	const dir = scratch({ "server/a.ts": "let x = 0;\n", "tools/gates/baseline/state.json": "{}\n" }, true);
	execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base"], { cwd: dir });
	writeFileSync(join(dir, "tools/gates/baseline/state.json"), '{"server/a.ts: top-level let x": 1}\n');
	const [state] = await runGates({ root: dir, only: "state", quiet: true });
	assert.deepEqual(state.problems, ["baseline gained server/a.ts: top-level let x"]);
});
test("--shrink lowers a baseline and never adds to it", async () => {
	const dir = scratch({ "server/a.ts": "let y = 0;\n", "tools/gates/baseline/state.json": '{"server/gone.ts: top-level let x": 1}\n' });
	const [state] = await runGates({ root: dir, only: "state", shrink: true, quiet: true });
	assert.deepEqual(state.problems, ["server/a.ts: top-level let y"]);
	assert.deepEqual(JSON.parse(execFileSync("cat", [join(dir, "tools/gates/baseline/state.json")], { encoding: "utf8" })), {});
});
test("--adopt records a moved folder's breaks and nothing else", async () => {
	const dir = scratch({ "harness/page/a.ts": "let x = 0;\n", "server/b.ts": "let y = 0;\n", "tools/gates/baseline/state.json": "{}\n" });
	const [state] = await runGates({ root: dir, only: "state", adopt: "harness/page/", quiet: true });
	assert.deepEqual(state.problems, ["server/b.ts: top-level let y"]);
	await assert.rejects(runGates({ root: dir, only: "state", adopt: "server/", quiet: true }), /moved folder/);
});
