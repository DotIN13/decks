// tools/check.mjs checks one folder alone: a broken neighbour fails only itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname;
const CHECK = join(ROOT, "tools/check.mjs");

function folder(base, name, code, testCode) {
	const dir = join(base, name);
	mkdirSync(dir, { recursive: true });
	const ext = relative(dir, join(ROOT, "tsconfig.folder.json"));
	writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ extends: ext, include: ["**/*.ts"], exclude: ["**/*.test.ts"] }));
	writeFileSync(join(dir, "a.ts"), code);
	if (testCode) writeFileSync(join(dir, "a.test.ts"), testCode);
	return relative(ROOT, dir);
}

test("a folder passes while its neighbour fails", () => {
	mkdirSync(join(ROOT, ".scratch"), { recursive: true });
	const base = mkdtempSync(join(ROOT, ".scratch/check-"));
	try {
		const good = folder(base, "good", "export const n: number = 1;\n", 'import { test } from "node:test";\ntest("ok", () => {});\n');
		const bad = folder(base, "bad", 'export const n: number = "one";\n');
		const run = (f) => spawnSync(process.execPath, [CHECK, f], { cwd: ROOT, encoding: "utf8" });
		const g = run(good), b = run(bad);
		assert.equal(g.status, 0, g.stdout + g.stderr);
		assert.match(g.stdout, /types pass; 1 test files pass/);
		assert.equal(b.status, 1);
		assert.match(b.stdout, /bad\/a\.ts.*TS2322/s);
	} finally { rmSync(base, { recursive: true, force: true }); }
});

test("a folder with no sources yet passes and says so", () => {
	const r = spawnSync(process.execPath, [CHECK, "tools/fixtures/drawings"], { cwd: ROOT, encoding: "utf8" });
	assert.equal(r.status, 0);
});

test("a hanging test file is killed, named, and fails the folder; the others run (tools/fixtures/check-hang)", () => {
	const started = Date.now();
	const r = spawnSync(process.execPath, [CHECK, "tools/fixtures/check-hang"], { cwd: ROOT, encoding: "utf8", env: { ...process.env, CHECK_FILE_MS: "3000" }, timeout: 60_000 });
	assert.equal(r.status, 1, r.stdout + r.stderr);
	assert.match(r.stdout, /hang\.test\.mjs: HUNG, killed after 3 s/);
	assert.match(r.stdout, /2 test files fail \(0 failing, 1 hung; hung: tools\/fixtures\/check-hang\/hang\.test\.mjs\)/);
	assert.ok(Date.now() - started < 30_000, "it did not wait for the hanging file");
});
