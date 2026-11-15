// Tests of the move script on the fixture tree in moves/fixtures/: node --test docs/rewrite/loom/move.test.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";
import { apply } from "./apply.mjs";
import { checkout, format, loadTable } from "./move.mjs";
import { after, mapper, plan, renames, setJson } from "./plan.mjs";

const HERE = new URL(".", import.meta.url).pathname;
const TREE = join(HERE, "moves/fixtures/tree");
const TABLE = join(HERE, "moves/fixtures/table.json");

function walk(dir, root = dir) {
	return readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n), root) : [relative(root, join(dir, n))]));
}
const tree = () => ({ files: walk(TREE).sort(), read: (f) => readFileSync(join(TREE, f), "utf8") });
const fixturePlan = () => plan(loadTable(TABLE), tree());
const line = (p, file, n) => p.edits.get(file).split("\n")[n - 1];

test("a path maps through the longest folder that holds it", () => {
	const map = mapper(loadTable(TABLE).moves);
	assert.equal(map("packages/lib/src/deep/inner.ts"), "lib/deep/inner.ts");
	assert.equal(map("packages/lib/package.json"), "lib/package.json");
	assert.equal(map("packages/lib/src"), "lib");
	assert.equal(map("packages/eng/target/bin"), "engine/target/bin");
	assert.equal(map("shared/util.ts"), "shared/util.ts");
});

test("a file move is found without its extension, as an import writes it", () => {
	const map = mapper([{ from: "a/Stage.tsx", to: "view/CanvasView.tsx" }]);
	assert.equal(map("a/Stage"), "view/CanvasView");
});

test("two files on one place, or a move onto a file that stays, are refused", () => {
	const map = mapper([{ from: "a/", to: "c/" }, { from: "b/", to: "c/" }]);
	assert.throws(() => renames(["a/x.ts", "b/x.ts"], map, new Set()), /both move to c\/x.ts/);
	assert.throws(() => renames(["a/x.ts", "c/x.ts"], mapper([{ from: "a/", to: "c/" }]), new Set()), /which stays/);
});

test("the fixture moves every tracked file under the moved folders, and untracks the built one", () => {
	const p = fixturePlan();
	assert.deepEqual(p.untrack, ["packages/eng/made/out.js"]);
	assert.deepEqual(p.moves.map(([, to]) => to).sort(), ["engine/.gitignore", "engine/package.json", "lib/deep/inner.ts", "lib/extra.ts", "lib/index.ts", "lib/package.json", "lib/tsconfig.json"]);
});

test("imports inside a moved folder that still land right are left alone", () => {
	const p = fixturePlan();
	assert.equal(p.edits.has("lib/extra.ts"), false);
	assert.equal(line(p, "lib/index.ts", 1), 'export * from "./extra.ts";');
	assert.equal(line(p, "lib/index.ts", 5), 'import "./deep/inner.ts";');
});

test("a moved file's import of a file that stays is rewritten from its new place", () => {
	assert.equal(line(fixturePlan(), "lib/index.ts", 2), 'import { util } from "../shared/util.ts";');
});

test("a file that stays is rewritten to reach a moved file, new URL included", () => {
	const p = fixturePlan();
	assert.equal(line(p, "server/main.ts", 2), 'import { extra } from "../lib/extra.ts";');
	assert.equal(line(p, "server/main.ts", 3), 'const deep = new URL("../lib/deep/", import.meta.url);');
});

test("a URL made from another address than the module's is not a path, and is left alone", () => {
	const r = tree();
	const files = [...r.files, "packages/lib/src/card.ts"];
	const read = (f) => (f === "packages/lib/src/card.ts" ? 'const at = new URL("../../assets/map.json", cardUrl);\n' : r.read(f));
	assert.equal(plan(loadTable(TABLE), { files, read }).edits.has("lib/card.ts"), false);
});

test("a package name is rewritten in imports, subpaths and package.json keys, not in longer names", () => {
	const p = fixturePlan();
	assert.equal(line(p, "lib/index.ts", 3), 'import { draw } from "@x/engine";');
	assert.equal(line(p, "lib/index.ts", 4), 'import { gl } from "@x/engine/gl";');
	assert.match(p.edits.get("server/package.json"), /"@x\/engine": "\*", "@x\/lib"/);
	assert.match(p.edits.get("server/main.ts"), /"@x\/engine-not-this"/);
});

test("package.json values are rewritten and its keys and scripts are not", () => {
	const text = fixturePlan().edits.get("lib/package.json");
	assert.match(text, /"\.": "\.\/index\.ts"/);
	assert.match(text, /"\.\/extra": "\.\/extra\.ts"/);
	assert.match(text, /"\.\/src\/index\.ts": "\.\/keep\.ts"/);
	assert.match(text, /node --test \.\/src\/x\.test\.ts/);
});

test("tsconfig extends follows the move, and the table sets include", () => {
	const t = JSON.parse(fixturePlan().edits.get("lib/tsconfig.json"));
	assert.equal(t.extends, "../tsconfig.base.json");
	assert.deepEqual(t.include, ["**/*.ts"]);
});

test("the table's paths, names, workspaces, ignore lines and new files are applied", () => {
	const p = fixturePlan();
	assert.equal(line(p, "server/main.ts", 4), 'const bin = "../engine/target/bin";');
	assert.equal(JSON.parse(p.edits.get("engine/package.json")).name, "@x/engine");
	assert.deepEqual(JSON.parse(p.edits.get("package.json")).workspaces, ["packages/*", "server", "lib", "engine"]);
	assert.equal(p.edits.get("engine/.gitignore"), "target/\nmade/\n");
	assert.match(p.edits.get("lib/README.md"), /## Owns/);
});

test("a path that matches a different number of times than the table says is refused", () => {
	const table = loadTable(TABLE);
	table.paths[0].replace[0].count = 2;
	assert.throws(() => plan(table, tree()), /found 1 times, expected 2/);
});

test("a folder named in a string or a comment is renamed by the table's mentions, after the imports", () => {
	const r = tree();
	const read = (f) => (f === "shared/util.ts" ? "// built in `packages/eng/target`\nexport const util = 1;\n" : r.read(f));
	assert.equal(plan(loadTable(TABLE), { files: r.files, read }).edits.get("shared/util.ts").split("\n")[0], "// built in `engine/target`");
});

test("an import that pointed at nothing before is not warned about; one that breaks is", () => {
	const p = fixturePlan();
	assert.equal(p.warnings.length, 0);
	const table = loadTable(TABLE);
	table.remove = ["shared/"];
	const broken = plan(table, tree());
	assert.deepEqual(broken.warnings, ["lib/index.ts: ../../../shared/util.ts points at shared/util.ts, which is not in the tree after the move"]);
});

test("old paths still written are listed, the README among them", () => {
	const p = fixturePlan();
	assert.deepEqual(p.leftovers.find((l) => l.file === "README.md"), { file: "README.md", count: 2 });
});

test("setJson keeps the file's indent and removes a value set to null", () => {
	assert.equal(setJson('{\n  "a": 1,\n  "b": 2\n}\n', { b: null, c: [1] }), '{\n  "a": 1,\n  "c": [\n    1\n  ]\n}\n');
});

test("the dry run text names every move and changed line", () => {
	const text = format(loadTable(TABLE), fixturePlan(), "test");
	assert.match(text, /- packages\/lib\/src\/extra\.ts -> lib\/extra\.ts/);
	assert.match(text, /server\/main\.ts:2\n {2}- import \{ extra \} from "\.\.\/packages\/lib\/src\/extra\.ts";\n {2}\+ import \{ extra \} from "\.\.\/lib\/extra\.ts";/);
});

test("--go on a git copy of the fixture moves, carries built files, writes and stages", () => {
	const root = mkdtempSync(join(tmpdir(), "loom-move-"));
	try {
		cpSync(TREE, root, { recursive: true });
		const git = (...a) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "core.hooksPath=/dev/null", ...a], { cwd: root, encoding: "utf8" });
		git("init", "-q");
		git("add", ".");
		git("commit", "-q", "-m", "fixture");
		mkdirSync(join(root, "packages/eng/target"));
		writeFileSync(join(root, "packages/eng/target/bin"), "built");
		mkdirSync(join(root, "packages/lib/node_modules"));
		const table = loadTable(TABLE);
		apply(root, table, plan(table, checkout(root)));
		assert.equal(existsSync(join(root, "packages")), false);
		assert.equal(readFileSync(join(root, "engine/target/bin"), "utf8"), "built");
		assert.equal(readFileSync(join(root, "engine/made/out.js"), "utf8").trim(), "export const draw = 1, gl = 2;");
		assert.match(readFileSync(join(root, "server/main.ts"), "utf8"), /"\.\.\/lib\/extra\.ts"/);
		const status = git("status", "--porcelain");
		assert.match(status, /^R {2}packages\/lib\/src\/deep\/inner\.ts -> lib\/deep\/inner\.ts$/m);
		assert.match(status, /^D {2}packages\/eng\/made\/out\.js$/m);
		assert.match(status, /^A {2}lib\/README\.md$/m);
		assert.doesNotMatch(status, /^.M /m);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("a table can delete files, and an import of a deleted file is warned about", () => {
	const table = { step: "t", title: "t", moves: [], remove: ["shared/"] };
	const p = plan(table, tree());
	assert.deepEqual(p.remove, ["shared/util.ts"]);
	assert.equal(p.untrack.length, 0);
	assert.match(p.warnings[0], /shared\/util\.ts, which is not in the tree/);
});

test("inside a folder a package name can become a relative path to one file", () => {
	const table = { step: "t", title: "t", moves: [], localize: [{ within: "packages/lib/", name: "@x/eng", target: "packages/eng/made/out.js" }] };
	const p = plan(table, tree());
	assert.equal(line(p, "packages/lib/src/index.ts", 3), 'import { draw } from "../../eng/made/out.js";');
	assert.equal(line(p, "packages/lib/src/index.ts", 4), 'import { gl } from "@x/eng/gl";');
	assert.equal(p.edits.has("server/main.ts"), false);
});

test("a dotted key sets or removes a value inside a JSON object", () => {
	assert.equal(setJson('{\n\t"d": { "@a/b": "*", "c": "1" }\n}\n', { "d.@a/b": null, "e.f": 2 }), '{\n\t"d": {\n\t\t"c": "1"\n\t},\n\t"e": {\n\t\t"f": 2\n\t}\n}\n');
});

test("a step is planned on top of an earlier one without moving anything", () => {
	const first = plan(loadTable(TABLE), tree());
	const next = after(tree(), first);
	assert.equal(next.files.includes("lib/extra.ts"), true);
	assert.equal(next.files.includes("packages/eng/made/out.js"), false);
	assert.match(next.read("server/main.ts"), /"\.\.\/lib\/extra\.ts"/);
	const second = plan({ step: "t", title: "t", moves: [{ from: "lib/extra.ts", to: "lib/more/extra.ts" }] }, next);
	assert.equal(second.edits.get("server/main.ts").split("\n")[1], 'import { extra } from "../lib/more/extra.ts";');
	assert.equal(second.edits.get("lib/index.ts").split("\n")[0], 'export * from "./more/extra.ts";');
});

test("a package name mapped to a subpath is rewritten in code but never as a dependency key", () => {
	const table = { step: "t", title: "t", moves: [], specifiers: { "@x/eng": "@x/lib/eng" } };
	const p = plan(table, tree());
	assert.equal(line(p, "packages/lib/src/index.ts", 3), 'import { draw } from "@x/lib/eng";');
	assert.equal(p.edits.has("server/package.json"), false);
});

test("a key given as a JSON list reaches a name with dots in it", () => {
	assert.equal(JSON.parse(setJson('{\n\t"exports": {}\n}\n', { '["exports","./ink"]': "./ink/index.ts" })).exports["./ink"], "./ink/index.ts");
});

test("a removed folder still gives up the files a table moves out of it", () => {
	const table = { step: "t", title: "t", moves: [{ from: "packages/lib/src/extra.ts", to: "shared/extra.ts" }], remove: ["packages/lib/"] };
	const p = plan(table, tree());
	assert.deepEqual(p.moves, [["packages/lib/src/extra.ts", "shared/extra.ts"]]);
	assert.equal(p.remove.includes("packages/lib/src/index.ts"), true);
	assert.equal(p.remove.includes("packages/lib/src/extra.ts"), false);
});

test("a package name is never made relative in a JSON file, and a moved file is never skipped", () => {
	const table = { step: "t", title: "t", moves: [{ from: "shared/util.ts", to: "packages/lib/src/util.ts" }], skip: ["shared/", "server/"], localize: [{ within: "server/", name: "@x/eng", target: "packages/eng/made/out.js" }] };
	const r = tree();
	const read = (f) => (f === "shared/util.ts" ? 'import { x } from "../server/main.ts";\n' : r.read(f));
	const p = plan(table, { files: r.files, read });
	assert.equal(p.edits.get("packages/lib/src/util.ts").trim(), 'import { x } from "../../../server/main.ts";');
	assert.equal(p.edits.has("server/package.json"), false);
});

test("a mention can be limited to the files of one folder", () => {
	const table = { step: "t", title: "t", moves: [], mentions: [["util", "tool", "shared/"]] };
	const p = plan(table, tree());
	assert.equal(p.edits.get("shared/util.ts").trim(), "export const tool = 1;");
	assert.equal(p.edits.has("packages/lib/src/index.ts"), false);
});
