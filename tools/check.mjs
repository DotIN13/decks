#!/usr/bin/env node
// Checks one folder alone: node tools/check.mjs <folder>, for example protocol, server or clients/sdk.
// Runs the folder's type check (tsconfig.json, and tsconfig.test.json if there) and its unit tests.
// Nothing outside the folder is checked, so a half-built neighbour fails only its owner.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);

const SKIP = new Set(["node_modules", "dist", "dist-gen", "fixtures", ".scratch"]);

function typeCheck(dir) {
	const configs = ["tsconfig.json", "tsconfig.test.json"].filter((c) => existsSync(join(dir, c)));
	if (!configs.length) return { ok: true, note: "no tsconfig.json, type check skipped" };
	const results = configs.map((c) => tscOnce(join(dir, c)));
	const ok = results.every((r) => r.ok);
	return { ok, note: results.map((r, i) => `${configs[i]}: ${r.note}`).join(", ") };
}

function tscOnce(config) {
	const tsc = join(ROOT, "node_modules/.bin/tsc");
	const r = spawnSync(tsc, ["-p", config, "--noEmit"], { encoding: "utf8" });
	const text = r.stdout + r.stderr;
	if (r.status !== 0 && /TS18003/.test(text)) return { ok: true, note: "no source files yet" };
	if (r.status !== 0) process.stdout.write(text);
	return { ok: r.status === 0, note: r.status === 0 ? "types pass" : "types fail" };
}

/**
 * The folder's tests, with a temp directory of their own (TMPDIR): whatever they leave in it fails the
 * folder, named, and the directory goes either way, so no run fills the machine's temp folder.
 */
function unitTests(dir) {
	const files = testFiles(dir);
	if (!files.length) return { ok: true, note: "no tests yet" };
	const temp = mkdtempSync(join(tmpdir(), "decks-check-"));
	try {
		const r = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], { cwd: ROOT, stdio: "inherit", env: { ...process.env, TMPDIR: temp, TEMP: temp, TMP: temp } });
		const left = leftIn(temp);
		if (left.length) console.error(`check: the tests left ${left.length} thing(s) in the temp folder: ${left.slice(0, 8).join(", ")}${left.length > 8 ? ", ..." : ""}`);
		const ok = r.status === 0 && !left.length;
		return { ok, note: `${files.length} test files ${r.status !== 0 ? "fail" : left.length ? `pass but leave ${left.length} temp folder(s)` : "pass"}` };
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
}

/** What a run left in its temp directory, but the folders macOS, node and tsx make there themselves. */
export function leftIn(temp) {
	return readdirSync(temp).filter((name) => !/^(com\.apple\.|node-compile-cache|tsx-\d+$|\.)/.test(name));
}

/** Test files under dir; a folder with its own package.json is another project, checked by itself. */
export function testFiles(dir) {
	const out = [];
	for (const name of readdirSync(dir)) {
		if (SKIP.has(name) || name.startsWith(".")) continue;
		const path = join(dir, name);
		if (statSync(path).isDirectory()) {
			if (!existsSync(join(path, "package.json"))) out.push(...testFiles(path));
		}
		else if (/\.test\.(ts|mts|mjs)$/.test(name)) out.push(path);
	}
	return out.sort();
}

function main(arg) {
	if (!arg) { console.error("usage: node tools/check.mjs <folder>"); return 2; }
	const dir = resolve(ROOT, arg);
	if (!existsSync(dir) || !statSync(dir).isDirectory()) { console.error(`check: no folder ${arg}`); return 2; }
	const types = typeCheck(dir);
	const tests = unitTests(dir);
	console.log(`check ${relative(ROOT, dir)}: ${types.note}; ${tests.note}`);
	return types.ok && tests.ok ? 0 : 1;
}

if (process.argv[1] === new URL(import.meta.url).pathname) process.exitCode = main(process.argv[2]);
