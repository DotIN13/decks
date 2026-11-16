#!/usr/bin/env node
// Checks one folder alone: node tools/check.mjs <folder>, for example protocol, server or clients/sdk.
// Runs the folder's type check (tsconfig.json, and tsconfig.test.json if there) and its unit tests.
// Nothing outside the folder is checked, so a half-built neighbour fails only its owner.
// Each test file runs in a process group of its own, four at a time, and one still running after
// CHECK_FILE_MS (two minutes) is killed, group and all, and named as hung, which fails the folder.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);

const SKIP = new Set(["node_modules", "dist", "dist-gen", "fixtures", ".scratch"]);

/** How long one test file may run before it is killed and named as hung. */
export const CHECK_FILE_MS = Number(process.env.CHECK_FILE_MS ?? 120_000);

/** How many test files run at once. */
const AT_ONCE = 4;

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
async function unitTests(dir) {
	const files = testFiles(dir);
	if (!files.length) return { ok: true, note: "no tests yet" };
	const temp = mkdtempSync(join(tmpdir(), "decks-check-"));
	try {
		// NODE_TEST_CONTEXT is a parent test runner's, when this check runs inside one: each file reports to us.
		const { NODE_TEST_CONTEXT: _parent, ...outer } = process.env;
		const env = { ...outer, TMPDIR: temp, TEMP: temp, TMP: temp };
		const results = await pool(files, (file) => testFile(file, env));
		const failed = results.filter((r) => r.status === "fail");
		const hung = results.filter((r) => r.status === "hung");
		for (const r of [...failed, ...hung]) process.stdout.write(`\n--- ${relative(ROOT, r.file)}: ${r.status === "hung" ? `HUNG, killed after ${CHECK_FILE_MS / 1000} s` : "fails"}\n${r.output.split("\n").slice(-60).join("\n")}\n`);
		const left = leftIn(temp);
		if (left.length) console.error(`check: the tests left ${left.length} thing(s) in the temp folder: ${left.slice(0, 8).join(", ")}${left.length > 8 ? ", ..." : ""}`);
		const ok = !failed.length && !hung.length && !left.length;
		const hungNote = hung.length ? `; hung: ${hung.map((r) => relative(ROOT, r.file)).join(", ")}` : "";
		const state = failed.length || hung.length ? `fail (${failed.length} failing, ${hung.length} hung${hungNote})` : left.length ? `pass but leave ${left.length} temp folder(s)` : "pass";
		return { ok, note: `${files.length} test files ${state}` };
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
}

/** One test file in a process group of its own, killed whole when it outlives CHECK_FILE_MS. */
function testFile(file, env) {
	return new Promise((done) => {
		const child = spawn(process.execPath, ["--import", "tsx", "--test", file], { cwd: ROOT, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
		let output = "";
		child.stdout.on("data", (chunk) => (output += chunk));
		child.stderr.on("data", (chunk) => (output += chunk));
		let hung = false;
		const timer = setTimeout(() => {
			hung = true;
			try { process.kill(-child.pid, "SIGKILL"); } catch {}
		}, CHECK_FILE_MS);
		child.on("close", (code) => {
			clearTimeout(timer);
			// Anything the file started and left behind goes with it.
			try { process.kill(-child.pid, "SIGKILL"); } catch {}
			done({ file, status: hung ? "hung" : code === 0 ? "pass" : "fail", output });
		});
	});
}

/** Run work over items, AT_ONCE at a time, answers in the items' order. */
async function pool(items, work) {
	const out = new Array(items.length);
	let next = 0;
	const lane = async () => {
		while (next < items.length) {
			const i = next++;
			out[i] = await work(items[i]);
		}
	};
	await Promise.all(Array.from({ length: Math.min(AT_ONCE, items.length) }, lane));
	return out;
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

async function main(arg) {
	if (!arg) { console.error("usage: node tools/check.mjs <folder>"); return 2; }
	const dir = resolve(ROOT, arg);
	if (!existsSync(dir) || !statSync(dir).isDirectory()) { console.error(`check: no folder ${arg}`); return 2; }
	const types = typeCheck(dir);
	const tests = await unitTests(dir);
	console.log(`check ${relative(ROOT, dir)}: ${types.note}; ${tests.note}`);
	return types.ok && tests.ok ? 0 : 1;
}

if (process.argv[1] === new URL(import.meta.url).pathname) process.exitCode = await main(process.argv[2]);
